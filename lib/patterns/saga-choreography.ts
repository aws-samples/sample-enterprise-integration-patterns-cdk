import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
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

export interface SagaStep {
  name: string;
  handler: string;
  code: lambda.Code;
  compensationHandler: string;
  compensationCode: lambda.Code;
}

export interface SagaChoreographyProps extends BasePatternProps {
  steps: SagaStep[];
  runtime?: lambda.Runtime;
}

export class SagaChoreography extends Construct {
  public readonly successTopics: sns.Topic[] = [];
  public readonly failureTopics: sns.Topic[] = [];
  public readonly queues: sqs.Queue[] = [];
  public readonly compensationQueues: sqs.Queue[] = [];
  public readonly functions: lambda.Function[] = [];
  public readonly compensationFunctions: lambda.Function[] = [];
  /** Producers send the initial trigger message to this queue. */
  public get entryQueue(): sqs.Queue {
    if (this.queues.length === 0) {
      throw new Error('SagaChoreography has no steps; entryQueue is undefined.');
    }
    return this.queues[0];
  }

  constructor(scope: Construct, id: string, props: SagaChoreographyProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = props.runtime ?? DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;
    const maxReceive = dlqMaxReceive(props);
    const retention = dlqRetention(props);

    for (const step of props.steps) {
      this.successTopics.push(new sns.Topic(this, `${step.name}SuccessTopic`, { enforceSSL: true }));
      this.failureTopics.push(new sns.Topic(this, `${step.name}FailureTopic`, { enforceSSL: true }));

      const dlq = new sqs.Queue(this, `${step.name}DLQ`, {
        retentionPeriod: retention,
        removalPolicy: removal,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.queues.push(
        new sqs.Queue(this, `${step.name}Queue`, {
          deadLetterQueue: { queue: dlq, maxReceiveCount: maxReceive },
          removalPolicy: removal,
          enforceSSL: true,
          encryption: sqs.QueueEncryption.SQS_MANAGED,
        }),
      );

      const compDlq = new sqs.Queue(this, `${step.name}CompDLQ`, {
        retentionPeriod: retention,
        removalPolicy: removal,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.compensationQueues.push(
        new sqs.Queue(this, `${step.name}CompQueue`, {
          deadLetterQueue: { queue: compDlq, maxReceiveCount: maxReceive },
          removalPolicy: removal,
          enforceSSL: true,
          encryption: sqs.QueueEncryption.SQS_MANAGED,
        }),
      );
    }

    for (const [i, step] of props.steps.entries()) {
      if (i > 0) {
        this.successTopics[i - 1].addSubscription(new subscriptions.SqsSubscription(this.queues[i]));
      }

      const fn = new lambda.Function(this, `${step.name}Fn`, {
        runtime,
        handler: step.handler,
        code: step.code,
        timeout,
        logRetention,
        environment: {
          STEP_NAME: step.name,
          SUCCESS_TOPIC_ARN: this.successTopics[i].topicArn,
          FAILURE_TOPIC_ARN: this.failureTopics[i].topicArn,
        },
      });
      this.functions.push(fn);
      fn.addEventSource(new lambdaEvents.SqsEventSource(this.queues[i]));
      this.successTopics[i].grantPublish(fn);
      this.failureTopics[i].grantPublish(fn);

      const compFn = new lambda.Function(this, `${step.name}CompensateFn`, {
        runtime,
        handler: step.compensationHandler,
        code: step.compensationCode,
        timeout,
        logRetention,
        environment: {
          STEP_NAME: step.name,
          PREV_FAILURE_TOPIC_ARN: i > 0 ? this.failureTopics[i - 1].topicArn : '',
        },
      });
      this.compensationFunctions.push(compFn);
      compFn.addEventSource(new lambdaEvents.SqsEventSource(this.compensationQueues[i]));
      if (i > 0) {
        this.failureTopics[i - 1].grantPublish(compFn);
      }

      this.failureTopics[i].addSubscription(new subscriptions.SqsSubscription(this.compensationQueues[i]));
    }
  }
}
