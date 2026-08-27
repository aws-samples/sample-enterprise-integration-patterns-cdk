import { Construct } from 'constructs';
import * as mq from 'aws-cdk-lib/aws-amazonmq';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy } from 'aws-cdk-lib';
import { BasePatternProps, dlqRetention } from '../types';
import { MqDeploymentMode } from './publish-subscribe-mq';

export interface RequestReplyMqProps extends BasePatternProps {
  vpc: ec2.IVpc;
  brokerSecret: secretsmanager.ISecret;
  brokerSecurityGroup: ec2.ISecurityGroup;
  brokerName?: string;
  instanceType?: string;
  deploymentMode?: MqDeploymentMode;
  engineVersion?: string;
  /** ActiveMQ destination name producers send requests to. */
  requestDestination?: string;
  /** ActiveMQ destination name consumers reply on. */
  replyDestination?: string;
}

/**
 * Request-Reply over Amazon MQ (ACTIVEMQ).
 *
 * Provisions the broker (encrypted, optionally HA) and an SQS DLQ surfaced for
 * caller-managed mappings. Consumers wire their own Lambda or EC2 listener to the
 * request/reply destinations on the broker; this construct intentionally does
 * not pre-bind a consumer because Request-Reply MQ topologies vary per domain.
 */
export class RequestReplyMq extends Construct {
  public readonly broker: mq.CfnBroker;
  public readonly dlq: sqs.Queue;
  public readonly requestDestination: string;
  public readonly replyDestination: string;

  constructor(scope: Construct, id: string, props: RequestReplyMqProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const deploymentMode = props.deploymentMode ?? 'ACTIVE_STANDBY_MULTI_AZ';
    this.requestDestination = props.requestDestination ?? 'requests';
    this.replyDestination = props.replyDestination ?? 'replies';

    const subnets = props.vpc.privateSubnets;
    if (deploymentMode === 'ACTIVE_STANDBY_MULTI_AZ' && subnets.length < 2) {
      throw new Error(
        `RequestReplyMq: ACTIVE_STANDBY_MULTI_AZ requires at least two private subnets; vpc has ${subnets.length}.`,
      );
    }
    const subnetIds =
      deploymentMode === 'ACTIVE_STANDBY_MULTI_AZ'
        ? [subnets[0].subnetId, subnets[1].subnetId]
        : [subnets[0].subnetId];

    this.dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

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
  }
}
