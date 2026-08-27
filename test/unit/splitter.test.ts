import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Splitter } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('Splitter', () => {
  function build(outputQueueCount = 3) {
    const { stack } = makeStack();
    new Splitter(stack, 'Sp', {
      splitterHandler: 'index.handler',
      splitterCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      outputQueueCount,
    });
    return stack;
  }

  test('creates input queue + topic + N output queues with DLQs', () => {
    const t = templateOf(build(3));
    t.resourceCountIs('AWS::SNS::Topic', 1);
    // input + dlq + N output + N output-dlq
    t.resourceCountIs('AWS::SQS::Queue', 2 + 3 * 2);
    assertPatternFunctionCount(t, 1);
  });

  test('output queues subscribe to topic', () => {
    const t = templateOf(build(2));
    const subs = t.findResources('AWS::SNS::Subscription');
    const sqsSubs = Object.values(subs).filter((s: any) => s.Properties?.Protocol === 'sqs');
    expect(sqsSubs.length).toBe(2);
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });
});
