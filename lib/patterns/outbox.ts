import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as pipes from 'aws-cdk-lib/aws-pipes';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import { BasePatternProps, dlqRetention } from '../types';

export interface OutboxProps extends BasePatternProps {
  /** Optional pre-existing topic. If omitted, an SNS topic is created. */
  destinationTopic?: sns.ITopic;
  /** Filter pattern applied to DDB stream events before publishing. */
  filterPattern?: string;
}

/**
 * Transactional Outbox (modern EIP).
 *
 * Producers write business state and an outbox row in the same DynamoDB transaction.
 * DDB Streams + EventBridge Pipes relay the outbox rows to SNS, giving exactly-once
 * publication semantics relative to the producer's transaction.
 *
 * Caller writes to `outboxTable` with attributes (partitionKey/sortKey of choice plus
 * `eventType`, `payload`). The pipe forwards INSERT events to the topic.
 */
export class Outbox extends Construct {
  public readonly outboxTable: dynamodb.Table;
  public readonly topic: sns.ITopic;
  public readonly pipe: pipes.CfnPipe;
  public readonly pipeDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: OutboxProps = {}) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;

    this.outboxTable = new dynamodb.Table(this, 'OutboxTable', {
      partitionKey: { name: 'aggregateId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: removal,
    });

    this.topic = props.destinationTopic ?? new sns.Topic(this, 'OutboxTopic', { enforceSSL: true });

    this.pipeDlq = new sqs.Queue(this, 'PipeDLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const role = new iam.Role(this, 'PipeRole', {
      assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
    });
    this.outboxTable.grantStreamRead(role);
    if (this.outboxTable.tableStreamArn) {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams'],
          resources: [this.outboxTable.tableStreamArn],
        }),
      );
    }
    (this.topic as sns.ITopic).grantPublish(role);
    this.pipeDlq.grantSendMessages(role);

    this.pipe = new pipes.CfnPipe(this, 'OutboxPipe', {
      roleArn: role.roleArn,
      source: this.outboxTable.tableStreamArn!,
      target: this.topic.topicArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          startingPosition: 'LATEST',
          batchSize: 10,
          deadLetterConfig: { arn: this.pipeDlq.queueArn },
          maximumRetryAttempts: 3,
        },
        filterCriteria: props.filterPattern
          ? { filters: [{ pattern: props.filterPattern }] }
          : { filters: [{ pattern: '{"eventName":["INSERT"]}' }] },
      },
      targetParameters: {
        inputTemplate: '<$.dynamodb.NewImage>',
      },
    });
  }
}
