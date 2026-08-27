import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { PublishSubscribeSns } from '../../lib';
import {
  assertAllQueuesSecure,
  assertLambdaWithHandler,
  assertQueuesHaveDlq,
  makeStack,
  templateOf,
} from './helpers';

describe('PublishSubscribeSns', () => {
  test('creates topic, subscriber queues, DLQs with secure defaults', () => {
    const { stack } = makeStack();
    new PublishSubscribeSns(stack, 'PubSub', { subscriberQueues: 3 });
    const t = templateOf(stack);

    t.resourceCountIs('AWS::SNS::Topic', 1);
    t.resourceCountIs('AWS::SQS::Queue', 6); // 3 queues + 3 DLQs
    t.hasResourceProperties('AWS::SNS::Topic', Match.objectLike({}));
    assertAllQueuesSecure(t);
    assertQueuesHaveDlq(t);
  });

  test('topic enforces SSL via topic policy', () => {
    const { stack } = makeStack();
    new PublishSubscribeSns(stack, 'PubSub', {});
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::SNS::TopicPolicy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Deny',
              Condition: Match.objectLike({
                Bool: Match.objectLike({ 'aws:SecureTransport': 'false' }),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  test('FIFO + Lambda subscriber combination throws', () => {
    const { stack } = makeStack();
    expect(
      () =>
        new PublishSubscribeSns(stack, 'PubSub', {
          fifo: true,
          subscriberLambdas: [
            { handler: 'index.handler', code: lambda.Code.fromInline('exports.handler = async () => {};') },
          ],
        }),
    ).toThrow(/FIFO topics cannot have Lambda subscriptions/i);
  });

  test('Lambda subscriptions get a shared DLQ', () => {
    const { stack } = makeStack();
    new PublishSubscribeSns(stack, 'PubSub', {
      subscriberLambdas: [
        { handler: 'index.handler', code: lambda.Code.fromInline('exports.handler = async () => {};') },
        { handler: 'index.handler', code: lambda.Code.fromInline('exports.handler = async () => {};') },
      ],
    });
    const t = templateOf(stack);
    // Two Lambda subscriptions sharing a single DLQ — at least one queue must be a DLQ for Lambda subs.
    const subscriptions = t.findResources('AWS::SNS::Subscription');
    const lambdaSubs = Object.values(subscriptions).filter(
      (s: any) => s.Properties?.Protocol === 'lambda',
    );
    expect(lambdaSubs.length).toBe(2);
    for (const s of lambdaSubs) {
      expect((s as any).Properties.RedrivePolicy).toBeDefined();
    }
  });

  test('publishers receive grantPublish on construction', () => {
    const { stack } = makeStack();
    const fn = new lambda.Function(stack, 'Pub', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    new PublishSubscribeSns(stack, 'PubSub', { publishers: [fn] });
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'sns:Publish' }),
          ]),
        }),
      }),
    );
  });
});
