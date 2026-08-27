import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { IdempotentReceiver } from '../../lib';
import {
  assertAllQueuesSecure,
  assertAllTablesPointInTimeRecovery,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('IdempotentReceiver', () => {
  function build() {
    const { stack } = makeStack();
    new IdempotentReceiver(stack, 'Ir', {
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
      idAttributeName: 'orderId',
      dedupTtlSeconds: 3600,
    });
    return stack;
  }

  test('creates input queue + dlq + dedup table + handler', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::SQS::Queue', 2);
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    assertPatternFunctionCount(t, 1);
  });

  test('dedup table partition key matches idAttributeName', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::DynamoDB::Table',
      Match.objectLike({
        KeySchema: Match.arrayWith([
          Match.objectLike({ AttributeName: 'orderId', KeyType: 'HASH' }),
        ]),
      }),
    );
  });

  test('handler env carries DEDUP_TABLE + DEDUP_TTL_SECONDS', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            DEDUP_TABLE: Match.anyValue(),
            DEDUP_TTL_SECONDS: '3600',
            DEDUP_ID_ATTRIBUTE: 'orderId',
          }),
        }),
      }),
    );
  });

  test('queues secure + table PITR', () => {
    const t = templateOf(build());
    assertAllQueuesSecure(t);
    assertAllTablesPointInTimeRecovery(t);
  });
});
