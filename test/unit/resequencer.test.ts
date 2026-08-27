import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { Resequencer } from '../../lib';
import {
  assertAllQueuesSecure,
  assertAllTablesPointInTimeRecovery,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('Resequencer', () => {
  function build() {
    const { stack } = makeStack();
    new Resequencer(stack, 'Rs', {
      collectorHandler: 'index.handler',
      collectorCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      dispatcherHandler: 'index.handler',
      dispatcherCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    return stack;
  }

  test('creates input + output queues + state table + collector + dispatcher', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::SQS::Queue', 3); // input, output, dlq
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    assertPatternFunctionCount(t, 2);
  });

  test('state table sort key is sequenceId NUMBER', () => {
    const t = templateOf(build());
    t.hasResourceProperties(
      'AWS::DynamoDB::Table',
      Match.objectLike({
        KeySchema: Match.arrayWith([
          Match.objectLike({ AttributeName: 'sequenceId', KeyType: 'RANGE' }),
        ]),
      }),
    );
  });

  test('dispatcher receives OUTPUT_QUEUE_URL env', () => {
    const t = templateOf(build());
    const fns = t.findResources('AWS::Lambda::Function');
    const urls = Object.values(fns)
      .map((f: any) => f.Properties.Environment?.Variables?.OUTPUT_QUEUE_URL)
      .filter(Boolean);
    expect(urls.length).toBeGreaterThanOrEqual(1);
  });

  test('queues secure + table PITR', () => {
    const t = templateOf(build());
    assertAllQueuesSecure(t);
    assertAllTablesPointInTimeRecovery(t);
  });
});
