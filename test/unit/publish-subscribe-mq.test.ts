import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Match } from 'aws-cdk-lib/assertions';
import { PublishSubscribeMq } from '../../lib';
import { assertAllQueuesSecure, makeStack, templateOf } from './helpers';

describe('PublishSubscribeMq', () => {
  function setup(deploymentMode: 'SINGLE_INSTANCE' | 'ACTIVE_STANDBY_MULTI_AZ' = 'ACTIVE_STANDBY_MULTI_AZ') {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const sg = new ec2.SecurityGroup(stack, 'Sg', { vpc });
    const secret = new secretsmanager.Secret(stack, 'Secret');
    new PublishSubscribeMq(stack, 'Mq', {
      vpc,
      brokerSecret: secret,
      brokerSecurityGroup: sg,
      deploymentMode,
      subscribers: [
        {
          name: 'Sub1',
          destination: 'queue.events',
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
        },
      ],
    });
    return stack;
  }

  test('default deployment is multi-AZ active-standby', () => {
    const stack = setup();
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::AmazonMQ::Broker',
      Match.objectLike({ DeploymentMode: 'ACTIVE_STANDBY_MULTI_AZ' }),
    );
  });

  test('broker uses encryption + auto-minor-version-upgrade + general logging', () => {
    const stack = setup();
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::AmazonMQ::Broker',
      Match.objectLike({
        EncryptionOptions: Match.objectLike({ UseAwsOwnedKey: true }),
        AutoMinorVersionUpgrade: true,
        Logs: Match.objectLike({ General: true }),
      }),
    );
  });

  test('throws when ACTIVE_STANDBY_MULTI_AZ requested but vpc has only one AZ', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'OneAzVpc', { maxAzs: 1 });
    const sg = new ec2.SecurityGroup(stack, 'Sg', { vpc });
    const secret = new secretsmanager.Secret(stack, 'Secret');
    expect(
      () =>
        new PublishSubscribeMq(stack, 'Mq', {
          vpc,
          brokerSecret: secret,
          brokerSecurityGroup: sg,
        }),
    ).toThrow(/at least two private subnets/i);
  });

  test('subscribers get an MQ event source mapping with BASIC_AUTH', () => {
    const stack = setup();
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::Lambda::EventSourceMapping',
      Match.objectLike({
        Queues: ['queue.events'],
        SourceAccessConfigurations: Match.arrayWith([
          Match.objectLike({ Type: 'BASIC_AUTH' }),
        ]),
      }),
    );
  });

  test('response queue uses secure defaults', () => {
    const stack = setup();
    assertAllQueuesSecure(templateOf(stack));
  });

  // Lambda rejects CreateEventSourceMapping for an MQ source unless the execution
  // role can describe the broker and manage ENIs in its VPC. The mapping resource
  // existing in the template is not enough; this pins the permissions it needs.
  test('subscriber role can describe the broker and manage VPC ENIs', () => {
    const t = templateOf(setup());
    const policies = t.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (p: any) => p.Properties?.PolicyDocument?.Statement ?? [],
    );
    const actions = new Set<string>(
      statements.flatMap((s: any) => (Array.isArray(s.Action) ? s.Action : [s.Action])),
    );
    for (const required of [
      'mq:DescribeBroker',
      'ec2:CreateNetworkInterface',
      'ec2:DeleteNetworkInterface',
      'ec2:DescribeNetworkInterfaces',
      'ec2:DescribeSecurityGroups',
      'ec2:DescribeSubnets',
      'ec2:DescribeVpcs',
    ]) {
      expect(actions).toContain(required);
    }
  });

  test('mq:DescribeBroker is scoped to this broker, not a wildcard', () => {
    const t = templateOf(setup());
    const policies = t.findResources('AWS::IAM::Policy');
    const describeStmt = Object.values(policies)
      .flatMap((p: any) => p.Properties?.PolicyDocument?.Statement ?? [])
      .find((s: any) => {
        const acts = Array.isArray(s.Action) ? s.Action : [s.Action];
        return acts.includes('mq:DescribeBroker');
      });
    expect(describeStmt).toBeDefined();
    expect(describeStmt.Resource).not.toBe('*');
  });
});
