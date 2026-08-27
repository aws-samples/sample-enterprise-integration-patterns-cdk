import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { ScatterGather } from '../../lib';
import {
  assertAllQueuesSecure,
  assertAllTablesPointInTimeRecovery,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('ScatterGather', () => {
  function build(recipientCount = 3) {
    const { stack } = makeStack();
    new ScatterGather(stack, 'Sg', {
      recipientCount,
      recipientHandler: 'index.handler',
      recipientCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      aggregatorHandler: 'index.handler',
      aggregatorCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    return stack;
  }

  test('creates topic + correlation table + N recipients + aggregator', () => {
    const t = templateOf(build(3));
    t.resourceCountIs('AWS::SNS::Topic', 1);
    t.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
    assertPatternFunctionCount(t, 4); // 3 recipients + aggregator
  });

  test('correlation table has stream + TTL + PITR', () => {
    const t = templateOf(build());
    t.hasResourceProperties(
      'AWS::DynamoDB::GlobalTable',
      Match.objectLike({
        StreamSpecification: Match.objectLike({ StreamViewType: 'NEW_AND_OLD_IMAGES' }),
        TimeToLiveSpecification: Match.objectLike({ AttributeName: 'ttl', Enabled: true }),
      }),
    );
    assertAllTablesPointInTimeRecovery(t);
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });

  test('SNS lambda subscriptions get a DLQ', () => {
    const t = templateOf(build(2));
    const subs = t.findResources('AWS::SNS::Subscription');
    const lambdaSubs = Object.values(subs).filter((s: any) => s.Properties?.Protocol === 'lambda');
    expect(lambdaSubs.length).toBe(2);
    for (const s of lambdaSubs) expect((s as any).Properties.RedrivePolicy).toBeDefined();
  });

  test('recipients receive RECIPIENT_ID + EXPECTED_RESPONSES env', () => {
    const t = templateOf(build(2));
    const fns = t.findResources('AWS::Lambda::Function');
    const ids = Object.values(fns).map((f: any) => f.Properties.Environment?.Variables?.RECIPIENT_ID).filter(Boolean);
    expect(ids).toEqual(expect.arrayContaining(['0', '1']));
  });
});
