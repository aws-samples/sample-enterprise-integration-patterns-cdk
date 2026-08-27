import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { RoutingSlip } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('RoutingSlip', () => {
  function build() {
    const { stack } = makeStack();
    new RoutingSlip(stack, 'Rs', {
      steps: [
        { name: 'validate', handler: 'index.handler', code: lambda.Code.fromInline('exports.handler = async () => {};') },
        { name: 'enrich',   handler: 'index.handler', code: lambda.Code.fromInline('exports.handler = async () => {};') },
        { name: 'publish',  handler: 'index.handler', code: lambda.Code.fromInline('exports.handler = async () => {};') },
      ],
    });
    return stack;
  }

  test('state machine + entry queue + dispatcher + step lambdas + orchestrator', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    t.resourceCountIs('AWS::SQS::Queue', 2);
    // 3 steps + dispatcher + orchestrator = 5
    assertPatternFunctionCount(t, 5);
  });

  test('dispatcher has invoke permissions to all steps', () => {
    const t = templateOf(build());
    t.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'lambda:InvokeFunction' }),
          ]),
        }),
      }),
    );
  });

  test('state machine tracing', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::StepFunctions::StateMachine',
      Match.objectLike({ TracingConfiguration: Match.objectLike({ Enabled: true }) }),
    );
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });
});
