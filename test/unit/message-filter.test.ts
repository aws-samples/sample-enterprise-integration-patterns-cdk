import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { MessageFilter } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('MessageFilter', () => {
  function buildFor(target: 'lambda' | 'sqs' | 'sns') {
    const { stack } = makeStack();
    const bus = new events.EventBus(stack, 'Bus');
    new MessageFilter(stack, 'Mf', {
      eventBus: bus,
      eventPattern: { source: ['orders'] },
      target,
      ...(target === 'lambda'
        ? {
            lambdaConfig: {
              handler: 'index.handler',
              code: lambda.Code.fromInline('exports.handler = async () => {};'),
            },
          }
        : {}),
    });
    return stack;
  }

  test('SQS target — creates output queue + dlq', () => {
    const t = templateOf(buildFor('sqs'));
    t.resourceCountIs('AWS::SQS::Queue', 2);
    assertAllQueuesSecure(t);
  });

  test('Lambda target — creates handler', () => {
    const t = templateOf(buildFor('lambda'));
    assertPatternFunctionCount(t, 1);
  });

  test('SNS target — creates topic with enforceSSL', () => {
    const t = templateOf(buildFor('sns'));
    t.resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('rule has DLQ wired', () => {
    const t = templateOf(buildFor('sqs'));
    t.hasResourceProperties(
      'AWS::Events::Rule',
      Match.objectLike({
        Targets: Match.arrayWith([
          Match.objectLike({ DeadLetterConfig: Match.objectLike({ Arn: Match.anyValue() }) }),
        ]),
      }),
    );
  });
});
