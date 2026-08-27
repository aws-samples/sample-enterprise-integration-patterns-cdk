import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
} from '../types';

export interface SagaOrchestratorStep {
  name: string;
  handler: string;
  code: lambda.Code;
  compensationHandler?: string;
  compensationCode?: lambda.Code;
}

export interface SagaOrchestrationProps extends BasePatternProps {
  steps: SagaOrchestratorStep[];
  runtime?: lambda.Runtime;
}

export class SagaOrchestration extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly stateQueue: sqs.Queue;
  public readonly stateDlq: sqs.Queue;
  public readonly orchestrator: lambda.Function;
  public readonly stepFunctions: lambda.Function[] = [];
  public readonly compensationFunctions: (lambda.Function | undefined)[] = [];

  constructor(scope: Construct, id: string, props: SagaOrchestrationProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = props.runtime ?? DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.stateDlq = new sqs.Queue(this, 'StateDLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.stateQueue = new sqs.Queue(this, 'StateQueue', {
      deadLetterQueue: { queue: this.stateDlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Build step + compensation lambdas keeping arrays index-aligned with props.steps.
    for (const step of props.steps) {
      const fn = new lambda.Function(this, `${step.name}Fn`, {
        runtime,
        handler: step.handler,
        code: step.code,
        timeout,
        logRetention,
        environment: { STATE_QUEUE_URL: this.stateQueue.queueUrl },
      });
      this.stepFunctions.push(fn);
      this.stateQueue.grantSendMessages(fn);

      if (step.compensationHandler && step.compensationCode) {
        const comp = new lambda.Function(this, `${step.name}Compensate`, {
          runtime,
          handler: step.compensationHandler,
          code: step.compensationCode,
          timeout,
          logRetention,
        });
        this.compensationFunctions.push(comp);
      } else {
        this.compensationFunctions.push(undefined);
      }
    }

    // Build the Step Functions definition forward: step0 -> step1 -> ... -> Succeed.
    // Each step has a Catch that routes to its own compensation (if any) -> Fail.
    const successState = new sfn.Succeed(this, 'SagaComplete');
    const invokeStates: tasks.LambdaInvoke[] = props.steps.map(
      (step, i) =>
        new tasks.LambdaInvoke(this, `Invoke${step.name}`, {
          lambdaFunction: this.stepFunctions[i],
          resultPath: `$.${step.name}Result`,
        }),
    );

    for (let i = 0; i < props.steps.length; i++) {
      const step = props.steps[i];
      const comp = this.compensationFunctions[i];
      const failState = new sfn.Fail(this, `${step.name}Failed`);
      const catchTarget: sfn.IChainable = comp
        ? new tasks.LambdaInvoke(this, `Compensate${step.name}`, {
            lambdaFunction: comp,
            resultPath: `$.${step.name}Compensation`,
          }).next(failState)
        : failState;
      invokeStates[i].addCatch(catchTarget, { resultPath: `$.${step.name}Error` });
    }

    // Wire forward: invoke[0] -> invoke[1] -> ... -> invoke[n-1] -> Succeed.
    // .next() mutates the underlying state graph, so traversing once is enough.
    if (invokeStates.length > 0) {
      for (let i = 0; i < invokeStates.length - 1; i++) {
        invokeStates[i].next(invokeStates[i + 1]);
      }
      invokeStates[invokeStates.length - 1].next(successState);
    }
    const definition: sfn.IChainable = invokeStates.length > 0 ? invokeStates[0] : successState;

    this.stateMachine = new sfn.StateMachine(this, 'SagaStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(30),
      tracingEnabled: true,
    });

    this.orchestrator = new lambda.Function(this, 'Orchestrator', {
      runtime,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
        const sfn = new SFNClient();
        exports.handler = async (event) => {
          for (const record of event.Records) {
            await sfn.send(new StartExecutionCommand({
              stateMachineArn: process.env.STATE_MACHINE_ARN,
              input: record.body,
            }));
          }
        };
      `),
      timeout,
      logRetention,
      environment: { STATE_MACHINE_ARN: this.stateMachine.stateMachineArn },
    });
    this.orchestrator.addEventSource(new lambdaEvents.SqsEventSource(this.stateQueue));
    this.stateMachine.grantStartExecution(this.orchestrator);
  }
}
