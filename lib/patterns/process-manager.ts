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

export interface ProcessManagerStep {
  name: string;
  handler: string;
  code: lambda.Code;
  /** Optional retry policy for this step. */
  maxRetries?: number;
}

export interface ProcessManagerProps extends BasePatternProps {
  steps: ProcessManagerStep[];
  runtime?: lambda.Runtime;
  /** Total workflow timeout. Default: 30 minutes. */
  workflowTimeout?: Duration;
}

/**
 * Process Manager (EIP).
 *
 * Linear, centrally orchestrated workflow without compensation logic. Each step
 * runs in sequence; failure ends the workflow. Use Saga Orchestration when you
 * need rollback semantics; use this when "stop on failure" is acceptable
 * (approval workflows, data ingestion pipelines, BPM-lite use cases).
 */
export class ProcessManager extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly stateQueue: sqs.Queue;
  public readonly stateDlq: sqs.Queue;
  public readonly orchestrator: lambda.Function;
  public readonly stepFunctions: lambda.Function[] = [];

  constructor(scope: Construct, id: string, props: ProcessManagerProps) {
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

    const invokeStates: tasks.LambdaInvoke[] = [];
    for (const step of props.steps) {
      const fn = new lambda.Function(this, `${step.name}Fn`, {
        runtime,
        handler: step.handler,
        code: step.code,
        timeout,
        logRetention,
      });
      this.stepFunctions.push(fn);
      const invoke = new tasks.LambdaInvoke(this, `Invoke${step.name}`, {
        lambdaFunction: fn,
        resultPath: `$.${step.name}Result`,
      });
      if (step.maxRetries && step.maxRetries > 0) {
        invoke.addRetry({ maxAttempts: step.maxRetries, backoffRate: 2.0, interval: Duration.seconds(2) });
      }
      invokeStates.push(invoke);
    }

    const success = new sfn.Succeed(this, 'WorkflowComplete');
    if (invokeStates.length > 0) {
      for (let i = 0; i < invokeStates.length - 1; i++) {
        invokeStates[i].next(invokeStates[i + 1]);
      }
      invokeStates[invokeStates.length - 1].next(success);
    }
    const definition: sfn.IChainable = invokeStates.length > 0 ? invokeStates[0] : success;

    this.stateMachine = new sfn.StateMachine(this, 'WorkflowStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: props.workflowTimeout ?? Duration.minutes(30),
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
