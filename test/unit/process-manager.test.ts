import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { ProcessManager } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('ProcessManager', () => {
  function build() {
    const { stack } = makeStack();
    new ProcessManager(stack, 'Pm', {
      steps: [
        {
          name: 'A',
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
        },
        {
          name: 'B',
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
          maxRetries: 3,
        },
      ],
    });
    return stack;
  }

  test('state machine + state queue + dlq + step lambdas + orchestrator', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    t.resourceCountIs('AWS::SQS::Queue', 2);
    assertPatternFunctionCount(t, 3); // 2 steps + orchestrator
  });

  test('state machine has tracing enabled', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::StepFunctions::StateMachine',
      Match.objectLike({ TracingConfiguration: Match.objectLike({ Enabled: true }) }),
    );
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });
});
