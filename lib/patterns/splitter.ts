import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
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

export interface SplitterProps extends BasePatternProps {
  splitterHandler: string;
  splitterCode: lambda.Code;
  runtime?: lambda.Runtime;
  outputQueueCount?: number;
}

export class Splitter extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly outputTopic: sns.Topic;
  public readonly splitter: lambda.Function;
  public readonly outputQueues: sqs.Queue[] = [];
  public readonly outputDlqs: sqs.Queue[] = [];

  constructor(scope: Construct, id: string, props: SplitterProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    const dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.inputQueue = new sqs.Queue(this, 'InputQueue', {
      deadLetterQueue: { queue: dlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.outputTopic = new sns.Topic(this, 'OutputTopic', { enforceSSL: true });

    this.splitter = new lambda.Function(this, 'Splitter', {
      runtime: props.runtime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.splitterHandler,
      code: props.splitterCode,
      timeout,
      logRetention,
      environment: { OUTPUT_TOPIC_ARN: this.outputTopic.topicArn },
    });
    this.splitter.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.outputTopic.grantPublish(this.splitter);

    for (let i = 0; i < (props.outputQueueCount ?? 1); i++) {
      const outDlq = new sqs.Queue(this, `OutputDLQ${i}`, {
        retentionPeriod: dlqRetention(props),
        removalPolicy: removal,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.outputDlqs.push(outDlq);
      const q = new sqs.Queue(this, `OutputQueue${i}`, {
        deadLetterQueue: { queue: outDlq, maxReceiveCount: dlqMaxReceive(props) },
        removalPolicy: removal,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.outputQueues.push(q);
      this.outputTopic.addSubscription(new subscriptions.SqsSubscription(q));
    }
  }
}
