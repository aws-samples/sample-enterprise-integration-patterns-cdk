import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { EventStreaming } from '../../lib';
import {
  assertAllTablesPointInTimeRecovery,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('EventStreaming', () => {
  function build() {
    const { stack } = makeStack();
    new EventStreaming(stack, 'Es', {
      shardCount: 2,
      retentionPeriodHours: 168,
      consumerHandler: 'index.handler',
      consumerCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    return stack;
  }

  test('creates Kinesis stream + audit table + consumer', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::Kinesis::Stream', 1);
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    assertPatternFunctionCount(t, 1);
  });

  test('stream uses managed encryption', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::Kinesis::Stream',
      Match.objectLike({
        StreamEncryption: Match.objectLike({ EncryptionType: 'KMS' }),
      }),
    );
  });

  test('event source mapping uses bisectBatchOnError', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::Lambda::EventSourceMapping',
      Match.objectLike({ BisectBatchOnFunctionError: true }),
    );
  });

  test('audit table has PITR', () => {
    assertAllTablesPointInTimeRecovery(templateOf(build()));
  });
});
