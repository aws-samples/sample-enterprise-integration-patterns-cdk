import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
} from '../types';

export interface PublishSubscribeSnsProps extends BasePatternProps {
  topicName?: string;
  fifo?: boolean;
  subscriberQueues?: number;
  subscriberLambdas?: { handler: string; runtime?: lambda.Runtime; code: lambda.Code }[];
  publishers?: iam.IGrantable[];
}

export class PublishSubscribeSns extends Construct {
  public readonly topic: sns.Topic;
  public readonly queues: sqs.Queue[] = [];
  public readonly dlqs: sqs.Queue[] = [];
  public readonly lambdaFunctions: lambda.Function[] = [];
  public readonly lambdaSubscriptionDlq?: sqs.Queue;

  constructor(scope: Construct, id: string, props: PublishSubscribeSnsProps = {}) {
    super(scope, id);

    const fifo = props.fifo ?? false;
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    if (fifo && (props.subscriberLambdas?.length ?? 0) > 0) {
      throw new Error(
        'PublishSubscribeSns: SNS FIFO topics cannot have Lambda subscriptions. ' +
          'Use SQS FIFO subscribers and trigger Lambda from those queues, or set fifo: false.',
      );
    }

    this.topic = new sns.Topic(this, 'Topic', {
      topicName: props.topicName,
      fifo,
      enforceSSL: true,
    });

    for (const publisher of props.publishers ?? []) {
      this.topic.grantPublish(publisher);
    }

    const queueCount = props.subscriberQueues ?? 1;
    for (let i = 0; i < queueCount; i++) {
      const dlq = new sqs.Queue(this, `DLQ${i}`, {
        retentionPeriod: dlqRetention(props),
        removalPolicy: removal,
        fifo,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.dlqs.push(dlq);

      const queue = new sqs.Queue(this, `Queue${i}`, {
        deadLetterQueue: { queue: dlq, maxReceiveCount: dlqMaxReceive(props) },
        removalPolicy: removal,
        fifo,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.queues.push(queue);
      this.topic.addSubscription(new subscriptions.SqsSubscription(queue));
    }

    if ((props.subscriberLambdas?.length ?? 0) > 0) {
      this.lambdaSubscriptionDlq = new sqs.Queue(this, 'LambdaSubDLQ', {
        retentionPeriod: dlqRetention(props),
        removalPolicy: removal,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
    }

    for (const [i, config] of (props.subscriberLambdas ?? []).entries()) {
      const fn = new lambda.Function(this, `Subscriber${i}`, {
        runtime: config.runtime ?? DEFAULT_LAMBDA_RUNTIME,
        handler: config.handler,
        code: config.code,
        timeout,
        logRetention,
      });
      this.lambdaFunctions.push(fn);
      this.topic.addSubscription(
        new subscriptions.LambdaSubscription(fn, { deadLetterQueue: this.lambdaSubscriptionDlq }),
      );
    }
  }

  /** Convenience: grant an additional publisher after construction */
  public grantPublish(publisher: iam.IGrantable): iam.Grant {
    return this.topic.grantPublish(publisher);
  }
}
