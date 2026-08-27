import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { RetryWithBackoff } from '../../lib';
import { assertAllQueuesSecure, makeStack, templateOf } from './helpers';

describe('RetryWithBackoff', () => {
  function build() {
    const { stack } = makeStack();
    new RetryWithBackoff(stack, 'Rwb', {
      workerHandler: 'index.handler',
      workerCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      initialVisibilityTimeoutSeconds: 30,
      backoffMultiplier: 2,
      maxAttempts: 6,
    });
    return stack;
  }

  test('queue with visibility timeout + DLQ + worker', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::SQS::Queue', 2);
    t.hasResourceProperties(
      'AWS::SQS::Queue',
      Match.objectLike({ VisibilityTimeout: 30 }),
    );
  });

  test('worker env carries retry tuning', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            RETRY_INITIAL_SECONDS: '30',
            RETRY_MULTIPLIER: '2',
            RETRY_MAX_ATTEMPTS: '6',
          }),
        }),
      }),
    );
  });

  test('worker has ChangeMessageVisibility permission', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['sqs:ChangeMessageVisibility']),
            }),
          ]),
        }),
      }),
    );
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });
});
