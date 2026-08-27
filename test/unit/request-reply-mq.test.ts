import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Match } from 'aws-cdk-lib/assertions';
import { RequestReplyMq } from '../../lib';
import { makeStack, templateOf } from './helpers';

describe('RequestReplyMq', () => {
  test('provisions a broker + DLQ', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const sg = new ec2.SecurityGroup(stack, 'Sg', { vpc });
    const secret = new secretsmanager.Secret(stack, 'Secret');
    new RequestReplyMq(stack, 'Mq', {
      vpc,
      brokerSecret: secret,
      brokerSecurityGroup: sg,
    });
    const t = templateOf(stack);
    t.resourceCountIs('AWS::AmazonMQ::Broker', 1);
    t.resourceCountIs('AWS::SQS::Queue', 1);
  });

  test('default deployment is multi-AZ', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const sg = new ec2.SecurityGroup(stack, 'Sg', { vpc });
    const secret = new secretsmanager.Secret(stack, 'Secret');
    new RequestReplyMq(stack, 'Mq', {
      vpc,
      brokerSecret: secret,
      brokerSecurityGroup: sg,
    });
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::AmazonMQ::Broker',
      Match.objectLike({ DeploymentMode: 'ACTIVE_STANDBY_MULTI_AZ' }),
    );
  });

  test('exposes request + reply destinations as construct properties', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const sg = new ec2.SecurityGroup(stack, 'Sg', { vpc });
    const secret = new secretsmanager.Secret(stack, 'Secret');
    const c = new RequestReplyMq(stack, 'Mq', {
      vpc,
      brokerSecret: secret,
      brokerSecurityGroup: sg,
      requestDestination: 'reqQ',
      replyDestination: 'repQ',
    });
    expect(c.requestDestination).toBe('reqQ');
    expect(c.replyDestination).toBe('repQ');
  });
});
