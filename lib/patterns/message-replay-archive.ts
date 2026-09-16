import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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
  queueVisibilityFor,
} from '../types';

export interface MessageReplayArchiveProps extends BasePatternProps {
  archiveHandler: string;
  archiveCode: lambda.Code;
  replayHandler: string;
  replayCode: lambda.Code;
  runtime?: lambda.Runtime;
  subscriberQueueCount?: number;
  /** Authorizer for the replay API. Pass undefined to fall back to IAM auth (still authenticated). */
  apiAuthorizer?: apigateway.IAuthorizer;
  apiAuthorizationType?: apigateway.AuthorizationType;
}

/**
 * Archives every message published to the topic to S3 + DynamoDB metadata, and exposes
 * an authenticated replay API.
 *
 * API routes (auth required by default — IAM unless `apiAuthorizer` is provided):
 *   GET  /messageArchive/by-date/{date}
 *   POST /messageArchive/replay/{messageId}
 */
export class MessageReplayArchive extends Construct {
  public readonly topic: sns.Topic;
  public readonly archiveBucket: s3.Bucket;
  public readonly metadataTable: dynamodb.Table;
  public readonly archiver: lambda.Function;
  public readonly replayer: lambda.Function;
  public readonly api: apigateway.RestApi;
  public readonly subscriberQueues: sqs.Queue[] = [];
  public readonly archiveSubscriptionDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: MessageReplayArchiveProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = props.runtime ?? DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.topic = new sns.Topic(this, 'Topic', { enforceSSL: true });

    this.archiveBucket = new s3.Bucket(this, 'ArchiveBucket', {
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
    });

    this.metadataTable = new dynamodb.Table(this, 'MetadataTable', {
      partitionKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: removal,
    });
    this.metadataTable.addGlobalSecondaryIndex({
      indexName: 'by-date',
      partitionKey: { name: 'dateKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    });

    const archiveDlq = new sqs.Queue(this, 'ArchiveDLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    const archiveQueue = new sqs.Queue(this, 'ArchiveQueue', {
      visibilityTimeout: queueVisibilityFor(timeout),
      deadLetterQueue: { queue: archiveDlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.topic.addSubscription(new subscriptions.SqsSubscription(archiveQueue));

    this.archiver = new lambda.Function(this, 'Archiver', {
      runtime,
      handler: props.archiveHandler,
      code: props.archiveCode,
      timeout,
      logRetention,
      environment: {
        ARCHIVE_BUCKET: this.archiveBucket.bucketName,
        METADATA_TABLE: this.metadataTable.tableName,
      },
    });
    this.archiver.addEventSource(new lambdaEvents.SqsEventSource(archiveQueue));
    this.archiveBucket.grantWrite(this.archiver);
    this.metadataTable.grantWriteData(this.archiver);

    this.archiveSubscriptionDlq = new sqs.Queue(this, 'SubscriberDLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    for (let i = 0; i < (props.subscriberQueueCount ?? 1); i++) {
      const q = new sqs.Queue(this, `SubscriberQueue${i}`, {
        deadLetterQueue: { queue: this.archiveSubscriptionDlq, maxReceiveCount: dlqMaxReceive(props) },
        removalPolicy: removal,
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
      });
      this.subscriberQueues.push(q);
      this.topic.addSubscription(new subscriptions.SqsSubscription(q));
    }

    this.replayer = new lambda.Function(this, 'Replayer', {
      runtime,
      handler: props.replayHandler,
      code: props.replayCode,
      timeout,
      logRetention,
      environment: {
        ARCHIVE_BUCKET: this.archiveBucket.bucketName,
        METADATA_TABLE: this.metadataTable.tableName,
        TOPIC_ARN: this.topic.topicArn,
      },
    });
    this.archiveBucket.grantRead(this.replayer);
    this.metadataTable.grantReadData(this.replayer);
    this.topic.grantPublish(this.replayer);

    this.api = new apigateway.RestApi(this, 'ReplayApi', {
      deployOptions: { tracingEnabled: true },
    });
    const authorizationType = props.apiAuthorizer
      ? apigateway.AuthorizationType.CUSTOM
      : props.apiAuthorizationType ?? apigateway.AuthorizationType.IAM;
    const methodOpts: apigateway.MethodOptions = {
      authorizationType,
      authorizer: props.apiAuthorizer,
    };

    // Path siblings under /messageArchive must not include both a path-parameter
    // ({date}) and a literal ('replay') at the same level — API Gateway rejects that.
    // Use distinct subresources instead.
    const archive = this.api.root.addResource('messageArchive');
    archive
      .addResource('by-date')
      .addResource('{date}')
      .addMethod('GET', new apigateway.LambdaIntegration(this.replayer), methodOpts);
    archive
      .addResource('replay')
      .addResource('{messageId}')
      .addMethod('POST', new apigateway.LambdaIntegration(this.replayer), methodOpts);
  }
}
