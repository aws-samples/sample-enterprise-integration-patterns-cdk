import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { ContentBasedRouter } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('ContentBasedRouter', () => {
  test('creates EventBus + rules + targets per rule', () => {
    const { stack } = makeStack();
    new ContentBasedRouter(stack, 'Router', {
      rules: [
        {
          eventPattern: { source: ['orders'] },
          target: 'lambda',
          lambdaConfig: {
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
          },
        },
        { eventPattern: { source: ['payments'] }, target: 'sqs' },
        { eventPattern: { source: ['notifications'] }, target: 'sns' },
      ],
    });
    const t = templateOf(stack);
    t.resourceCountIs('AWS::Events::EventBus', 1);
    t.resourceCountIs('AWS::Events::Rule', 3);
    assertPatternFunctionCount(t, 1);
    t.resourceCountIs('AWS::SQS::Queue', 2); // 1 SQS target + shared DLQ
    t.resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('all queues secure', () => {
    const { stack } = makeStack();
    new ContentBasedRouter(stack, 'Router', {
      rules: [{ eventPattern: { source: ['x'] }, target: 'sqs' }],
    });
    assertAllQueuesSecure(templateOf(stack));
  });

  test('rule targets reference DLQ', () => {
    const { stack } = makeStack();
    new ContentBasedRouter(stack, 'Router', {
      rules: [{ eventPattern: { source: ['x'] }, target: 'sqs' }],
    });
    const t = templateOf(stack);
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
