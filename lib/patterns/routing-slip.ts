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
  queueVisibilityFor,
} from '../types';

export interface RoutingSlipStep {
  /** Logical step name; must match values that producers put on the slip itinerary. */
  name: string;
  handler: string;
  code: lambda.Code;
}

export interface RoutingSlipProps extends BasePatternProps {
  /** Catalogue of steps the slip can reference. The producer chooses ordering at runtime. */
  steps: RoutingSlipStep[];
  runtime?: lambda.Runtime;
  workflowTimeout?: Duration;
}

/**
 * Routing Slip (EIP).
 *
 * The producer sends a message containing an `itinerary` array of step names.
 * Step Functions Map state iterates the itinerary; for each entry it invokes a
 * dispatcher Lambda that calls the matching step's handler. Steps are
 * independent; the slip itself carries the order.
 *
 * Producer payload contract:
 *   {
 *     "itinerary": ["validate", "enrich", "publish"],
 *     "payload":   { ... }
 *   }
 */
export class RoutingSlip extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly entryQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly orchestrator: lambda.Function;
  public readonly dispatcher: lambda.Function;
  public readonly stepFunctions: Record<string, lambda.Function> = {};

  constructor(scope: Construct, id: string, props: RoutingSlipProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const runtime = props.runtime ?? DEFAULT_LAMBDA_RUNTIME;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.entryQueue = new sqs.Queue(this, 'EntryQueue', {
      visibilityTimeout: queueVisibilityFor(timeout),
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    for (const step of props.steps) {
      this.stepFunctions[step.name] = new lambda.Function(this, `${step.name}Fn`, {
        runtime,
        handler: step.handler,
        code: step.code,
        timeout,
        logRetention,
      });
    }

    // Dispatcher reads `stepName` from the Map state input and forwards to the right handler.
    const stepNamesByArn: Record<string, string> = Object.fromEntries(
      Object.entries(this.stepFunctions).map(([name, fn]) => [name, fn.functionArn]),
    );
    this.dispatcher = new lambda.Function(this, 'Dispatcher', {
      runtime,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
        const lambda = new LambdaClient();
        const ARNS = ${JSON.stringify(stepNamesByArn)};
        exports.handler = async (event) => {
          const { stepName, payload } = event;
          const arn = ARNS[stepName];
          if (!arn) throw new Error("Unknown step: " + stepName);
          const out = await lambda.send(new InvokeCommand({
            FunctionName: arn,
            Payload: Buffer.from(JSON.stringify(payload)),
          }));
          const body = out.Payload ? JSON.parse(Buffer.from(out.Payload).toString()) : null;
          return { stepName, result: body };
        };
      `),
      timeout,
      logRetention,
    });
    for (const fn of Object.values(this.stepFunctions)) {
      fn.grantInvoke(this.dispatcher);
    }

    const dispatchTask = new tasks.LambdaInvoke(this, 'Dispatch', {
      lambdaFunction: this.dispatcher,
      payload: sfn.TaskInput.fromObject({
        'stepName.$': '$.stepName',
        'payload.$': '$.payload',
      }),
      resultPath: '$.dispatchResult',
    });

    const map = new sfn.Map(this, 'IterateItinerary', {
      itemsPath: sfn.JsonPath.stringAt('$.itinerary'),
      parameters: {
        'stepName.$': '$$.Map.Item.Value',
        'payload.$': '$.payload',
      },
      resultPath: '$.itineraryResults',
    });
    map.iterator(dispatchTask);
    map.next(new sfn.Succeed(this, 'SlipComplete'));

    this.stateMachine = new sfn.StateMachine(this, 'SlipStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(map),
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
    this.orchestrator.addEventSource(new lambdaEvents.SqsEventSource(this.entryQueue));
    this.stateMachine.grantStartExecution(this.orchestrator);
  }
}
