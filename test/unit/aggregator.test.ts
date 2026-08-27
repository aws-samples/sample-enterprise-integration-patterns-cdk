import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { Aggregator } from '../../lib';
import {
  assertAllQueuesSecure,
  assertAllTablesPointInTimeRecovery,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('Aggregator', () => {
  function build() {
    const { stack } = makeStack();
    new Aggregator(stack, 'Agg', {
      collectorHandler: 'index.handler',
      collectorCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      processorHandler: 'index.handler',
      processorCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      expectedBatchSize: 10,
    });
    return stack;
  }

  test('creates ingest queue + state table + collector + processor', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::SQS::Queue', 2); // ingest + DLQ
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    assertPatternFunctionCount(t, 2);
  });

  test('state table has stream + TTL + PITR', () => {
    const t = templateOf(build());
    t.hasResourceProperties(
      'AWS::DynamoDB::Table',
      Match.objectLike({
        StreamSpecification: Match.objectLike({ StreamViewType: 'NEW_AND_OLD_IMAGES' }),
        TimeToLiveSpecification: Match.objectLike({ AttributeName: 'ttl', Enabled: true }),
      }),
    );
    assertAllTablesPointInTimeRecovery(t);
  });

  test('processor has EXPECTED_BATCH_SIZE env when set', () => {
    const t = templateOf(build());
    const fns = t.findResources('AWS::Lambda::Function');
    const expected = Object.values(fns).map((f: any) =>
      f.Properties.Environment?.Variables?.EXPECTED_BATCH_SIZE,
    );
    expect(expected).toEqual(expect.arrayContaining(['10']));
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });
});
