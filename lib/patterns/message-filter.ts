import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqRetention,
} from '../types';

export interface MessageFilterProps extends BasePatternProps {
  /** Existing event bus to filter. */
  eventBus: events.IEventBus;
  /** Predicate as an EventBridge pattern — only matching messages reach the target. */
  eventPattern: events.EventPattern;
  /** Target type. */
  target: 'lambda' | 'sqs' | 'sns';
  lambdaConfig?: { handler: string; code: lambda.Code; runtime?: lambda.Runtime };
}

/**
 * Message Filter (EIP)
 *
 * Drops messages that do not match a predicate. Implemented declaratively as an
 * EventBridge rule + target. Cheap, deterministic, no Lambda hop unless the
 * caller targets one explicitly.
 */
export class MessageFilter extends Construct {
  public readonly rule: events.Rule;
  public readonly dlq: sqs.Queue;
  public readonly outputQueue?: sqs.Queue;
  public readonly outputTopic?: sns.Topic;
  public readonly outputFunction?: lambda.Function;

  constructor(scope: Construct, id: string, props: MessageFilterProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;

    this.dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.rule = new events.Rule(this, 'FilterRule', {
      eventBus: props.eventBus,
      eventPattern: props.eventPattern,
    });

    if (props.target === 'lambda' && props.lambdaConfig) {
      this.outputFunction = new lambda.Function(this, 'Handler', {
        runtime: props.lambdaConfig.runtime ?? DEFAULT_LAMBDA_RUNTIME,
        handler: props.lambdaConfig.handler,
        code: props.lambdaConfig.code,
        timeout: props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT,
        logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
      });
      this.rule.addTarget(new targets.LambdaFunction(this.outputFunction, { deadLetterQueue: this.dlq }));
    } else if (props.target === 'sqs') {
      this.outputQueue = new sqs.Queue(this, 'OutputQueue', {
        removalPolicy: removal,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.rule.addTarget(new targets.SqsQueue(this.outputQueue, { deadLetterQueue: this.dlq }));
    } else if (props.target === 'sns') {
      this.outputTopic = new sns.Topic(this, 'OutputTopic', { enforceSSL: true });
      this.rule.addTarget(new targets.SnsTopic(this.outputTopic, { deadLetterQueue: this.dlq }));
    }
  }
}
