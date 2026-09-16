import { Construct } from 'constructs';
import * as mq from 'aws-cdk-lib/aws-amazonmq';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
} from '../types';

export interface MqSubscriber {
  /** Logical name used as the construct ID prefix and as SUBSCRIBER_NAME env. */
  name: string;
  /** ActiveMQ destination this subscriber consumes from (queue or topic name on the broker). */
  destination: string;
  handler: string;
  code: lambda.Code;
}

export type MqDeploymentMode = 'SINGLE_INSTANCE' | 'ACTIVE_STANDBY_MULTI_AZ';

export interface PublishSubscribeMqProps extends BasePatternProps {
  vpc: ec2.IVpc;
  /** Secret containing both `username` and `password` keys. The broker references it via dynamic CFN reference; cleartext never lands in the template. */
  brokerSecret: secretsmanager.ISecret;
  /** Security group attached to the broker. Must allow Lambda → broker on AMQP/STOMP/etc. */
  brokerSecurityGroup: ec2.ISecurityGroup;
  brokerName?: string;
  instanceType?: string;
  /** Default: ACTIVE_STANDBY_MULTI_AZ for production-grade HA. */
  deploymentMode?: MqDeploymentMode;
  engineVersion?: string;
  subscribers?: MqSubscriber[];
}

/**
 * Publish-Subscribe with Amazon MQ (ACTIVEMQ).
 *
 * Each subscriber Lambda is wired to the broker via a Lambda MQ event source mapping that
 * consumes from the subscriber's named ActiveMQ destination. A shared response queue carries
 * correlated replies back to the original publisher.
 */
export class PublishSubscribeMq extends Construct {
  public readonly broker: mq.CfnBroker;
  public readonly subscriberFunctions: lambda.Function[] = [];
  public readonly responseQueue: sqs.Queue;
  public readonly responseDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: PublishSubscribeMqProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;
    const deploymentMode = props.deploymentMode ?? 'ACTIVE_STANDBY_MULTI_AZ';

    const subnets = props.vpc.privateSubnets;
    if (deploymentMode === 'ACTIVE_STANDBY_MULTI_AZ' && subnets.length < 2) {
      throw new Error(
        `PublishSubscribeMq: ACTIVE_STANDBY_MULTI_AZ requires at least two private subnets in different AZs; vpc has ${subnets.length}.`,
      );
    }
    const subnetIds =
      deploymentMode === 'ACTIVE_STANDBY_MULTI_AZ'
        ? [subnets[0].subnetId, subnets[1].subnetId]
        : [subnets[0].subnetId];

    this.broker = new mq.CfnBroker(this, 'Broker', {
      brokerName: props.brokerName ?? `${id}-broker`,
      engineType: 'ACTIVEMQ',
      engineVersion: props.engineVersion ?? '5.18.4',
      hostInstanceType: props.instanceType ?? 'mq.t3.micro',
      deploymentMode,
      publiclyAccessible: false,
      autoMinorVersionUpgrade: true,
      encryptionOptions: { useAwsOwnedKey: true },
      logs: { general: true },
      users: [
        {
          username: props.brokerSecret.secretValueFromJson('username').unsafeUnwrap(),
          password: props.brokerSecret.secretValueFromJson('password').unsafeUnwrap(),
        },
      ],
      subnetIds,
      securityGroups: [props.brokerSecurityGroup.securityGroupId],
    });

    this.responseDlq = new sqs.Queue(this, 'ResponseDLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.responseQueue = new sqs.Queue(this, 'ResponseQueue', {
      deadLetterQueue: { queue: this.responseDlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    for (const sub of props.subscribers ?? []) {
      const fn = new lambda.Function(this, `${sub.name}Fn`, {
        runtime,
        handler: sub.handler,
        code: sub.code,
        timeout,
        logRetention,
        environment: {
          RESPONSE_QUEUE_URL: this.responseQueue.queueUrl,
          SUBSCRIBER_NAME: sub.name,
          MQ_DESTINATION: sub.destination,
        },
      });
      this.subscriberFunctions.push(fn);
      this.responseQueue.grantSendMessages(fn);
      props.brokerSecret.grantRead(fn);

      // Lambda's Amazon MQ event source polls the broker on the function's behalf
      // and needs to describe it and manage ENIs in the broker's VPC. Without these,
      // CreateEventSourceMapping is rejected at deploy time. The secret read above
      // covers secretsmanager:GetSecretValue; these are the rest of the documented set:
      // https://docs.aws.amazon.com/lambda/latest/dg/process-mq-messages-with-lambda.html
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['mq:DescribeBroker'],
          resources: [this.broker.attrArn],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          // ENI lifecycle actions do not support resource-level scoping.
          actions: [
            'ec2:CreateNetworkInterface',
            'ec2:DeleteNetworkInterface',
            'ec2:DescribeNetworkInterfaces',
            'ec2:DescribeSecurityGroups',
            'ec2:DescribeSubnets',
            'ec2:DescribeVpcs',
          ],
          resources: ['*'],
        }),
      );

      // CDK's L2 EventSourceMapping does not expose Queues for Amazon MQ. Wire the L1.
      new lambda.CfnEventSourceMapping(this, `${sub.name}MqMapping`, {
        functionName: fn.functionName,
        eventSourceArn: this.broker.attrArn,
        queues: [sub.destination],
        batchSize: 10,
        sourceAccessConfigurations: [
          { type: 'BASIC_AUTH', uri: props.brokerSecret.secretArn },
        ],
      });
    }
  }
}
