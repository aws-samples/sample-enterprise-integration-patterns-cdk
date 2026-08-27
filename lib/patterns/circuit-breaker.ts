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

export interface CircuitBreakerProps extends BasePatternProps {
  /** Caller-supplied wrapper that calls the protected dependency. */
  handler: string;
  code: lambda.Code;
  runtime?: lambda.Runtime;
  /** Failure threshold before the breaker opens. Default: 5. */
  failureThreshold?: number;
  /** Cooldown in seconds before a half-open probe is allowed. Default: 30. */
  cooldownSeconds?: number;
  /** Logical breaker key. Use one breaker per downstream service. Default: id. */
  breakerKey?: string;
}

/**
 * Circuit Breaker (modern EIP).
 *
 * Tracks failure counts in DynamoDB. When the consumer Lambda detects the
 * configured threshold has been exceeded it writes an `OPEN` state with a
 * cooldown TTL; subsequent invocations short-circuit until the cooldown elapses
 * and a single half-open probe is allowed.
 *
 * The construct provisions the queue, the breaker state table, and the consumer.
 * Caller logic uses Lambda Powertools or equivalent against the surfaced env vars.
 */
export class CircuitBreaker extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly stateTable: dynamodb.Table;
  public readonly handler: lambda.Function;

  constructor(scope: Construct, id: string, props: CircuitBreakerProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;

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

    this.stateTable = new dynamodb.Table(this, 'BreakerStateTable', {
      partitionKey: { name: 'breakerKey', type: dynamodb.AttributeType.STRING },
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
        BREAKER_TABLE: this.stateTable.tableName,
        BREAKER_KEY: props.breakerKey ?? id,
        FAILURE_THRESHOLD: String(props.failureThreshold ?? 5),
        COOLDOWN_SECONDS: String(props.cooldownSeconds ?? 30),
      },
    });
    this.handler.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.stateTable.grantReadWriteData(this.handler);
  }
}
