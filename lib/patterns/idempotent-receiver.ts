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
} from '../types';

export interface IdempotentReceiverProps extends BasePatternProps {
  /** Caller's business handler. Receives only deduplicated messages. */
  handler: string;
  code: lambda.Code;
  runtime?: lambda.Runtime;
  /** Hash key field name on the dedup table. Default: messageId. */
  idAttributeName?: string;
  /** TTL applied to dedup records in seconds. Default: 86400 (24h). */
  dedupTtlSeconds?: number;
}

/**
 * Idempotent Receiver (EIP)
 *
 * Wraps a consumer Lambda with a DynamoDB-backed dedup table. The consumer must
 * record idempotency keys via conditional write (caller logic) — this construct
 * provisions the table and surfaces it via env so the handler can reject duplicates.
 *
 * For full at-most-once semantics callers should use the AWS Lambda Powertools
 * idempotency utility against the provisioned table.
 */
export class IdempotentReceiver extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly dedupTable: dynamodb.Table;
  public readonly handler: lambda.Function;

  constructor(scope: Construct, id: string, props: IdempotentReceiverProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const idAttr = props.idAttributeName ?? 'messageId';

    this.dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.inputQueue = new sqs.Queue(this, 'InputQueue', {
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.dedupTable = new dynamodb.Table(this, 'DedupTable', {
      partitionKey: { name: idAttr, type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: removal,
    });

    this.handler = new lambda.Function(this, 'Handler', {
      runtime: props.runtime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.handler,
      code: props.code,
      timeout: props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT,
      logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
      environment: {
        DEDUP_TABLE: this.dedupTable.tableName,
        DEDUP_ID_ATTRIBUTE: idAttr,
        DEDUP_TTL_SECONDS: String(props.dedupTtlSeconds ?? 86400),
      },
    });
    this.handler.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.dedupTable.grantReadWriteData(this.handler);
  }
}
