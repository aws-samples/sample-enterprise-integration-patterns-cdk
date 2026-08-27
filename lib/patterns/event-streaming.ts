import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
} from '../types';

export interface EventStreamingProps extends BasePatternProps {
  shardCount?: number;
  consumerHandler: string;
  consumerCode: lambda.Code;
  runtime?: lambda.Runtime;
  retentionPeriodHours?: number;
  /** Lambda batch size for the Kinesis event source. Default: 100. */
  batchSize?: number;
  /** Bisect batch on error to isolate poison records. Default: true. */
  bisectBatchOnError?: boolean;
}

export class EventStreaming extends Construct {
  public readonly stream: kinesis.Stream;
  public readonly consumer: lambda.Function;
  public readonly auditTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: EventStreamingProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.stream = new kinesis.Stream(this, 'Stream', {
      shardCount: props.shardCount ?? 1,
      retentionPeriod: Duration.hours(props.retentionPeriodHours ?? 24),
      encryption: kinesis.StreamEncryption.MANAGED,
      removalPolicy: removal,
    });

    this.auditTable = new dynamodb.Table(this, 'AuditTable', {
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: removal,
    });

    this.consumer = new lambda.Function(this, 'Consumer', {
      runtime: props.runtime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.consumerHandler,
      code: props.consumerCode,
      timeout,
      logRetention,
      environment: { AUDIT_TABLE: this.auditTable.tableName },
    });

    this.consumer.addEventSource(
      new lambdaEvents.KinesisEventSource(this.stream, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: props.batchSize ?? 100,
        bisectBatchOnError: props.bisectBatchOnError ?? true,
        retryAttempts: 3,
      }),
    );
    this.auditTable.grantWriteData(this.consumer);
  }
}
