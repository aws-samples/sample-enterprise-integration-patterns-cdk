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

export interface ResequencerProps extends BasePatternProps {
  collectorHandler: string;
  collectorCode: lambda.Code;
  dispatcherHandler: string;
  dispatcherCode: lambda.Code;
  runtime?: lambda.Runtime;
  ttlSeconds?: number;
}

export class Resequencer extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly outputQueue: sqs.Queue;
  public readonly stateTable: dynamodb.Table;
  public readonly collector: lambda.Function;
  public readonly dispatcher: lambda.Function;

  constructor(scope: Construct, id: string, props: ResequencerProps) {
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
    this.inputQueue = new sqs.Queue(this, 'InputQueue', {
      visibilityTimeout: queueVisibilityFor(timeout),
      deadLetterQueue: { queue: dlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.outputQueue = new sqs.Queue(this, 'OutputQueue', {
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.stateTable = new dynamodb.Table(this, 'StateTable', {
      partitionKey: { name: 'batchId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sequenceId', type: dynamodb.AttributeType.NUMBER },
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
    this.collector.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.stateTable.grantWriteData(this.collector);

    this.dispatcher = new lambda.Function(this, 'Dispatcher', {
      runtime,
      handler: props.dispatcherHandler,
      code: props.dispatcherCode,
      timeout,
      logRetention,
      environment: {
        STATE_TABLE: this.stateTable.tableName,
        OUTPUT_QUEUE_URL: this.outputQueue.queueUrl,
      },
    });
    this.dispatcher.addEventSource(
      new lambdaEvents.DynamoEventSource(this.stateTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        bisectBatchOnError: true,
        retryAttempts: 3,
      }),
    );
    this.stateTable.grantReadWriteData(this.dispatcher);
    this.outputQueue.grantSendMessages(this.dispatcher);
  }
}
