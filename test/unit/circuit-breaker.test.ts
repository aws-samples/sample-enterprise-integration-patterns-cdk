import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { CircuitBreaker } from '../../lib';
import {
  assertAllQueuesSecure,
  assertAllTablesPointInTimeRecovery,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('CircuitBreaker', () => {
  function build() {
    const { stack } = makeStack();
    new CircuitBreaker(stack, 'Cb', {
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
      failureThreshold: 7,
      cooldownSeconds: 45,
      breakerKey: 'pmt-gw',
    });
    return stack;
  }

  test('queue + dlq + state table + handler', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::SQS::Queue', 2);
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    assertPatternFunctionCount(t, 1);
  });

  test('handler env carries breaker config', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            BREAKER_KEY: 'pmt-gw',
            FAILURE_THRESHOLD: '7',
            COOLDOWN_SECONDS: '45',
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
