import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
} from '../types';

export interface RetryWithBackoffProps extends BasePatternProps {
  /** Caller's worker — should throw on transient failures so SQS redrives. */
  workerHandler: string;
  workerCode: lambda.Code;
  workerRuntime?: lambda.Runtime;
  /** Initial visibility timeout. Each redrive multiplies by `backoffMultiplier` up to `maxVisibilityTimeoutSeconds`. */
  initialVisibilityTimeoutSeconds?: number;
  /** Multiplier applied per retry. Default: 2 (exponential). */
  backoffMultiplier?: number;
  /** Cap for visibility timeout. Default: 900s (SQS max). */
  maxVisibilityTimeoutSeconds?: number;
  /** Max receives before DLQ — overrides BasePatternProps.deadLetterQueue.maxReceiveCount. */
  maxAttempts?: number;
}

/**
 * Retry with Backoff (modern EIP).
 *
 * Caller's worker throws on transient failure; SQS redrives with the configured
 * visibility timeout. The visibility timeout itself is the backoff window. The
 * worker reads `RETRY_*` env vars and, if it wants finer control than SQS gives
 * by default, can call `ChangeMessageVisibility` with an exponential delay
 * derived from `ApproximateReceiveCount`.
 */
export class RetryWithBackoff extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly worker: lambda.Function;

  constructor(scope: Construct, id: string, props: RetryWithBackoffProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const initial = props.initialVisibilityTimeoutSeconds ?? 30;
    const multiplier = props.backoffMultiplier ?? 2;
    const max = props.maxVisibilityTimeoutSeconds ?? 900;
    const attempts = props.maxAttempts ?? dlqMaxReceive(props);

    this.dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.inputQueue = new sqs.Queue(this, 'InputQueue', {
      visibilityTimeout: Duration.seconds(initial),
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: attempts },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.worker = new lambda.Function(this, 'Worker', {
      runtime: props.workerRuntime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.workerHandler,
      code: props.workerCode,
      timeout: props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT,
      logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
      environment: {
        QUEUE_URL: this.inputQueue.queueUrl,
        RETRY_INITIAL_SECONDS: String(initial),
        RETRY_MULTIPLIER: String(multiplier),
        RETRY_MAX_SECONDS: String(max),
        RETRY_MAX_ATTEMPTS: String(attempts),
      },
    });
    this.worker.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.inputQueue.grantConsumeMessages(this.worker);
    // Allow worker to extend visibility for adaptive backoff.
    this.inputQueue.grant(this.worker, 'sqs:ChangeMessageVisibility');
  }
}
