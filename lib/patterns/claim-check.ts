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
} from '../types';

export interface ClaimCheckProps extends BasePatternProps {
  checkinHandler: string;
  checkinCode: lambda.Code;
  checkoutHandler: string;
  checkoutCode: lambda.Code;
  runtime?: lambda.Runtime;
  bucketName?: string;
  payloadExpirationDays?: number;
}

export class ClaimCheck extends Construct {
  public readonly claimBucket: s3.Bucket;
  public readonly inputQueue: sqs.Queue;
  public readonly outputQueue: sqs.Queue;
  public readonly checkin: lambda.Function;
  public readonly checkout: lambda.Function;

  constructor(scope: Construct, id: string, props: ClaimCheckProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = props.runtime ?? DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.claimBucket = new s3.Bucket(this, 'ClaimBucket', {
      bucketName: props.bucketName,
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(props.payloadExpirationDays ?? 7) }],
    });

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
    this.outputQueue = new sqs.Queue(this, 'OutputQueue', {
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.checkin = new lambda.Function(this, 'Checkin', {
      runtime,
      handler: props.checkinHandler,
      code: props.checkinCode,
      timeout,
      logRetention,
      environment: {
        CLAIM_BUCKET: this.claimBucket.bucketName,
        OUTPUT_QUEUE_URL: this.outputQueue.queueUrl,
      },
    });
    this.checkin.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.claimBucket.grantWrite(this.checkin);
    this.outputQueue.grantSendMessages(this.checkin);

    this.checkout = new lambda.Function(this, 'Checkout', {
      runtime,
      handler: props.checkoutHandler,
      code: props.checkoutCode,
      timeout,
      logRetention,
      environment: { CLAIM_BUCKET: this.claimBucket.bucketName },
    });
    this.claimBucket.grantRead(this.checkout);
  }
}
