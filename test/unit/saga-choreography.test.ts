import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SagaChoreography } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('SagaChoreography', () => {
  function build(stepCount = 3) {
    const { stack } = makeStack();
    const steps = Array.from({ length: stepCount }, (_, i) => ({
      name: `Step${i + 1}`,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
      compensationHandler: 'index.handler',
      compensationCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    }));
    new SagaChoreography(stack, 'Saga', { steps });
    return stack;
  }

  test('creates 2N topics + 2N queues + 2N DLQs + 2N functions for N steps', () => {
    const N = 3;
    const t = templateOf(build(N));
    t.resourceCountIs('AWS::SNS::Topic', 2 * N); // success + failure per step
    // step queue + dlq + comp queue + comp dlq per step
    t.resourceCountIs('AWS::SQS::Queue', 4 * N);
    assertPatternFunctionCount(t, 2 * N); // step + comp per step
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build(2)));
  });

  test('exposes entryQueue', () => {
    const { stack } = makeStack();
    const c = new SagaChoreography(stack, 'Saga', {
      steps: [
        {
          name: 'A',
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
          compensationHandler: 'index.handler',
          compensationCode: lambda.Code.fromInline('exports.handler = async () => {};'),
        },
      ],
    });
    expect(c.entryQueue).toBeDefined();
  });
});
