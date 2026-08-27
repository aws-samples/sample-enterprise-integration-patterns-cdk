import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

export interface ScatterGatherProps extends BasePatternProps {
  recipientCount: number;
  recipientHandler: string;
  recipientCode: lambda.Code;
  aggregatorHandler: string;
  aggregatorCode: lambda.Code;
  runtime?: lambda.Runtime;
  gatherTtlSeconds?: number;
}

export class ScatterGather extends Construct {
  public readonly broadcastTopic: sns.Topic;
  public readonly gatherQueue: sqs.Queue;
  public readonly correlationTable: dynamodb.TableV2;
  public readonly aggregator: lambda.Function;
  public readonly recipients: lambda.Function[] = [];
  public readonly recipientSubscriptionDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: ScatterGatherProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = props.runtime ?? DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.broadcastTopic = new sns.Topic(this, 'BroadcastTopic', { enforceSSL: true });

    this.correlationTable = new dynamodb.TableV2(this, 'CorrelationTable', {
      partitionKey: { name: 'correlationId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'recipientId', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: removal,
      pointInTimeRecovery: true,
    });

    const gatherDlq = new sqs.Queue(this, 'GatherDLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.gatherQueue = new sqs.Queue(this, 'GatherQueue', {
      deadLetterQueue: { queue: gatherDlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.recipientSubscriptionDlq = new sqs.Queue(this, 'RecipientSubDLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.aggregator = new lambda.Function(this, 'Aggregator', {
      runtime,
      handler: props.aggregatorHandler,
      code: props.aggregatorCode,
      timeout,
      logRetention,
      environment: {
        CORRELATION_TABLE: this.correlationTable.tableName,
        EXPECTED_RESPONSES: String(props.recipientCount),
      },
    });
    this.aggregator.addEventSource(
      new lambdaEvents.DynamoEventSource(this.correlationTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        bisectBatchOnError: true,
        retryAttempts: 3,
      }),
    );
    this.correlationTable.grantReadData(this.aggregator);

    for (let i = 0; i < props.recipientCount; i++) {
      const fn = new lambda.Function(this, `Recipient${i}`, {
        runtime,
        handler: props.recipientHandler,
        code: props.recipientCode,
        timeout,
        logRetention,
        environment: {
          CORRELATION_TABLE: this.correlationTable.tableName,
          RECIPIENT_ID: String(i),
          TTL_SECONDS: String(props.gatherTtlSeconds ?? 300),
        },
      });
      this.recipients.push(fn);
      this.broadcastTopic.addSubscription(
        new subscriptions.LambdaSubscription(fn, { deadLetterQueue: this.recipientSubscriptionDlq }),
      );
      this.correlationTable.grantWriteData(fn);
    }
  }
}
