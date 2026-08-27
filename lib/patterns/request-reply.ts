import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
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

export interface RequestReplyProps extends BasePatternProps {
  consumerHandler: string;
  consumerCode: lambda.Code;
  consumerRuntime?: lambda.Runtime;
}

export class RequestReply extends Construct {
  public readonly requestQueue: sqs.Queue;
  public readonly replyQueue: sqs.Queue;
  public readonly requestDlq: sqs.Queue;
  public readonly replyDlq: sqs.Queue;
  public readonly consumer: lambda.Function;

  constructor(scope: Construct, id: string, props: RequestReplyProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const maxReceive = dlqMaxReceive(props);
    const retention = dlqRetention(props);

    this.requestDlq = new sqs.Queue(this, 'RequestDLQ', {
      retentionPeriod: retention,
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.replyDlq = new sqs.Queue(this, 'ReplyDLQ', {
      retentionPeriod: retention,
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.requestQueue = new sqs.Queue(this, 'RequestQueue', {
      deadLetterQueue: { queue: this.requestDlq, maxReceiveCount: maxReceive },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.replyQueue = new sqs.Queue(this, 'ReplyQueue', {
      deadLetterQueue: { queue: this.replyDlq, maxReceiveCount: maxReceive },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.consumer = new lambda.Function(this, 'Consumer', {
      runtime: props.consumerRuntime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.consumerHandler,
      code: props.consumerCode,
      timeout: props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT,
      logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
      environment: { REPLY_QUEUE_URL: this.replyQueue.queueUrl },
    });

    this.consumer.addEventSource(new lambdaEvents.SqsEventSource(this.requestQueue));
    this.replyQueue.grantSendMessages(this.consumer);
  }
}
