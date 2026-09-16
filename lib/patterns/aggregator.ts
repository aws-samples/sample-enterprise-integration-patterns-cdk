import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
  queueVisibilityFor,
} from '../types';

export interface AggregatorProps extends BasePatternProps {
  collectorHandler: string;
  collectorCode: lambda.Code;
  processorHandler: string;
  processorCode: lambda.Code;
  runtime?: lambda.Runtime;
  ttlSeconds?: number;
  /** Expected message count per batch — surfaced to the processor as EXPECTED_BATCH_SIZE. Caller logic decides completion. */
  expectedBatchSize?: number;
}

export class Aggregator extends Construct {
  public readonly ingestQueue: sqs.Queue;
  public readonly stateTable: dynamodb.Table;
  public readonly collector: lambda.Function;
  public readonly processor: lambda.Function;

  constructor(scope: Construct, id: string, props: AggregatorProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = props.runtime ?? DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    const dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.ingestQueue = new sqs.Queue(this, 'IngestQueue', {
      visibilityTimeout: queueVisibilityFor(timeout),
      deadLetterQueue: { queue: dlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.stateTable = new dynamodb.Table(this, 'StateTable', {
      partitionKey: { name: 'batchId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecovery: true,
      removalPolicy: removal,
    });

    this.collector = new lambda.Function(this, 'Collector', {
      runtime,
      handler: props.collectorHandler,
      code: props.collectorCode,
      timeout,
      logRetention,
      environment: {
        STATE_TABLE: this.stateTable.tableName,
        TTL_SECONDS: String(props.ttlSeconds ?? 300),
      },
    });
    this.collector.addEventSource(new lambdaEvents.SqsEventSource(this.ingestQueue));
    this.stateTable.grantWriteData(this.collector);

    this.processor = new lambda.Function(this, 'Processor', {
      runtime,
      handler: props.processorHandler,
      code: props.processorCode,
      timeout,
      logRetention,
      environment: {
        STATE_TABLE: this.stateTable.tableName,
        ...(props.expectedBatchSize !== undefined
          ? { EXPECTED_BATCH_SIZE: String(props.expectedBatchSize) }
          : {}),
      },
    });
    this.processor.addEventSource(
      new lambdaEvents.DynamoEventSource(this.stateTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        bisectBatchOnError: true,
        retryAttempts: 3,
      }),
    );
    this.stateTable.grantReadWriteData(this.processor);
  }
}
