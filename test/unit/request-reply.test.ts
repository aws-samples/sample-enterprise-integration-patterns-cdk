import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { RequestReply } from '../../lib';
import {
  assertAllQueuesSecure,
  assertLambdaWithHandler,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('RequestReply', () => {
  function build() {
    const { stack } = makeStack();
    const c = new RequestReply(stack, 'Rr', {
      consumerHandler: 'index.handler',
      consumerCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    return { stack, construct: c };
  }

  test('creates request + reply queues + DLQs + consumer', () => {
    const { stack } = build();
    const t = templateOf(stack);
    t.resourceCountIs('AWS::SQS::Queue', 4);
    assertPatternFunctionCount(t, 1);
    assertLambdaWithHandler(t, 'index.handler');
  });

  test('queues secure', () => {
    const { stack } = build();
    assertAllQueuesSecure(templateOf(stack));
  });

  test('consumer has REPLY_QUEUE_URL env', () => {
    const { stack } = build();
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({ REPLY_QUEUE_URL: Match.anyValue() }),
        }),
      }),
    );
  });

  test('consumer has IAM permission to send to reply queue', () => {
    const { stack } = build();
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: Match.arrayWith(['sqs:SendMessage']) }),
          ]),
        }),
      }),
    );
  });

  test('event source mapping wired between request queue and consumer', () => {
    const { stack } = build();
    const t = templateOf(stack);
    t.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
  });
});
