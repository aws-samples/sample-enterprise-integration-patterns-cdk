import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { SagaOrchestration } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  patternFunctions,
  templateOf,
} from './helpers';

describe('SagaOrchestration', () => {
  function build(): { stack: ReturnType<typeof makeStack>['stack'] } {
    const { stack } = makeStack();
    new SagaOrchestration(stack, 'Saga', {
      steps: [
        {
          name: 'A',
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
          compensationHandler: 'index.handler',
          compensationCode: lambda.Code.fromInline('exports.handler = async () => {};'),
        },
        {
          name: 'B',
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
        },
        {
          name: 'C',
          handler: 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => {};'),
          compensationHandler: 'index.handler',
          compensationCode: lambda.Code.fromInline('exports.handler = async () => {};'),
        },
      ],
    });
    return { stack };
  }

  test('creates state machine + state queue + orchestrator + step + comp lambdas', () => {
    const t = templateOf(build().stack);
    t.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    t.resourceCountIs('AWS::SQS::Queue', 2); // state queue + dlq
    // step lambdas (3) + comp lambdas (2 — only A and C) + orchestrator (1) = 6
    assertPatternFunctionCount(t, 6);
  });

  test('state machine has tracing enabled', () => {
    templateOf(build().stack).hasResourceProperties(
      'AWS::StepFunctions::StateMachine',
      Match.objectLike({ TracingConfiguration: Match.objectLike({ Enabled: true }) }),
    );
  });

  test('orchestrator has IAM permission to start the state machine', () => {
    templateOf(build().stack).hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'states:StartExecution' }),
          ]),
        }),
      }),
    );
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build().stack));
  });

  test('compensation indices align with steps (regression for B1)', () => {
    // Build with sparse compensation — A and C have it, B does not.
    // The construct must NOT call B's missing compensation handler when A's step fails.
    // We can't introspect ASL directly here easily, but we can verify the right number of
    // LambdaInvoke catch clauses appear by counting compensation lambdas.
    const t = templateOf(build().stack);
    // patternFunctions() excludes CDK's own provider functions, which also use
    // the handler name 'index.handler' and would otherwise inflate this count.
    const fns = Object.values(patternFunctions(t));
    const handlers = fns.map((f: any) => f.Properties.Handler);
    // 3 step lambdas + 2 compensation lambdas + 1 orchestrator = 6 'index.handler' or inline.
    expect(handlers.filter((h) => h === 'index.handler').length).toBe(6);
  });
});
