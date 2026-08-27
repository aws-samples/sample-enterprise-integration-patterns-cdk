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

export function defaultEncryption(): sqs.QueueEncryption {
  return sqs.QueueEncryption.SQS_MANAGED;
}
