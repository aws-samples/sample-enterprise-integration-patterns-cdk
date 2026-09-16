import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface DeadLetterQueueConfig {
  maxReceiveCount?: number;
  retentionPeriodDays?: number;
}

export interface BasePatternProps {
  removalPolicy?: RemovalPolicy;
  deadLetterQueue?: DeadLetterQueueConfig;
  /** CloudWatch log retention applied to every Lambda created by the pattern. Default: ONE_MONTH. */
  logRetention?: logs.RetentionDays;
  /** Default Lambda timeout for functions created by the pattern. Default: 30s. */
  lambdaTimeout?: Duration;
}

export const DEFAULT_DLQ_MAX_RECEIVE = 3;
export const DEFAULT_DLQ_RETENTION_DAYS = 14;
export const DEFAULT_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
export const DEFAULT_LAMBDA_TIMEOUT = Duration.seconds(30);

/**
 * Default Lambda runtime for every function created by a pattern in this library.
 *
 * Declared once on purpose. Lambda runtimes reach end of support on a published
 * schedule — AWS first blocks function *creation*, then blocks *updates* — so this
 * value has an expiry date and needs reviewing. Changing it here changes every
 * construct; callers who need a different runtime pass one through the relevant
 * `runtime` prop.
 *
 * Current value tracks the Node.js version in Active LTS. Check
 * https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html before a release.
 */
export const DEFAULT_LAMBDA_RUNTIME = lambda.Runtime.NODEJS_24_X;

export function dlqRetention(props: BasePatternProps): Duration {
  return Duration.days(props.deadLetterQueue?.retentionPeriodDays ?? DEFAULT_DLQ_RETENTION_DAYS);
}

export function dlqMaxReceive(props: BasePatternProps): number {
  return props.deadLetterQueue?.maxReceiveCount ?? DEFAULT_DLQ_MAX_RECEIVE;
}

/**
 * Visibility timeout for an SQS queue that feeds a Lambda function.
 *
 * Lambda rejects an SQS event source mapping whose function timeout exceeds the
 * queue's visibility timeout, and it does so at deploy time, not at synth. SQS
 * defaults to 30 s, which only happens to equal DEFAULT_LAMBDA_TIMEOUT; the first
 * caller to raise `lambdaTimeout` would otherwise get an InvalidParameterValue
 * from CreateEventSourceMapping with no hint that a queue setting caused it.
 *
 * AWS recommends at least six times the function timeout so that a throttled
 * invocation can be retried before the message reappears to another consumer.
 * https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html
 *
 * SQS caps visibility at 12 hours, so the multiple is clamped there; Lambda's
 * 15-minute maximum function timeout times six is 90 minutes, well inside it.
 */
export const SQS_VISIBILITY_MULTIPLIER = 6;
const SQS_MAX_VISIBILITY = Duration.hours(12);

export function queueVisibilityFor(functionTimeout: Duration): Duration {
  const proposed = Duration.seconds(functionTimeout.toSeconds() * SQS_VISIBILITY_MULTIPLIER);
  return proposed.toSeconds() > SQS_MAX_VISIBILITY.toSeconds() ? SQS_MAX_VISIBILITY : proposed;
}

export function defaultEncryption(): sqs.QueueEncryption {
  return sqs.QueueEncryption.SQS_MANAGED;
}
