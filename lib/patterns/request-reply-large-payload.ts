import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
  queueVisibilityFor,
} from '../types';

export interface RequestReplyLargePayloadProps extends BasePatternProps {
  consumerHandler: string;
  consumerCode: lambda.Code;
  consumerRuntime?: lambda.Runtime;
  bucketName?: string;
  payloadExpirationDays?: number;
}

export class RequestReplyLargePayload extends Construct {
  public readonly requestQueue: sqs.Queue;
  public readonly replyQueue: sqs.Queue;
  public readonly payloadBucket: s3.Bucket;
  public readonly consumer: lambda.Function;
  public readonly requestDlq: sqs.Queue;
  public readonly replyDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: RequestReplyLargePayloadProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const maxReceive = dlqMaxReceive(props);
    const retention = dlqRetention(props);

    this.payloadBucket = new s3.Bucket(this, 'PayloadBucket', {
      bucketName: props.bucketName,
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(props.payloadExpirationDays ?? 7) }],
    });

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
      visibilityTimeout: queueVisibilityFor(timeout),
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
      timeout,
      logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
      environment: {
        REPLY_QUEUE_URL: this.replyQueue.queueUrl,
        PAYLOAD_BUCKET: this.payloadBucket.bucketName,
      },
    });

    this.consumer.addEventSource(new lambdaEvents.SqsEventSource(this.requestQueue));
    this.replyQueue.grantSendMessages(this.consumer);
    this.payloadBucket.grantReadWrite(this.consumer);
  }
}
