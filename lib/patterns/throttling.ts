import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
} from '../types';

export interface ThrottlingProps extends BasePatternProps {
  /** Caller-supplied worker that performs the rate-limited downstream call. */
  workerHandler: string;
  workerCode: lambda.Code;
  workerRuntime?: lambda.Runtime;
  /** Reserved concurrency on the worker — the practical rate limit. */
  workerReservedConcurrency: number;
  /** Optional API Gateway facade with a usage plan. */
  createApi?: boolean;
  /** Steady-state requests per second for the API usage plan. */
  rateLimitRps?: number;
  /** Burst capacity for the API usage plan. */
  burstLimit?: number;
  /** Daily quota for the API usage plan. */
  dailyQuota?: number;
}

/**
 * Throttling / Rate Limiter (modern EIP).
 *
 * Two independent rate-control layers:
 *   1. SQS-fronted worker with reserved concurrency — protects downstream APIs
 *      from message-driven traffic spikes.
 *   2. Optional API Gateway facade with a usage plan — protects against
 *      partner-driven traffic spikes via API keys + quota.
 */
export class Throttling extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly worker: lambda.Function;
  public readonly api?: apigateway.RestApi;
  public readonly usagePlan?: apigateway.UsagePlan;
  public readonly apiKey?: apigateway.IApiKey;

  constructor(scope: Construct, id: string, props: ThrottlingProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;

    this.dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.inputQueue = new sqs.Queue(this, 'InputQueue', {
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.worker = new lambda.Function(this, 'Worker', {
      runtime: props.workerRuntime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.workerHandler,
      code: props.workerCode,
      timeout: props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT,
      logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
      reservedConcurrentExecutions: props.workerReservedConcurrency,
    });
    this.worker.addEventSource(
      new lambdaEvents.SqsEventSource(this.inputQueue, {
        batchSize: 1,
        maxConcurrency: Math.max(2, props.workerReservedConcurrency),
      }),
    );

    if (props.createApi) {
      this.api = new apigateway.RestApi(this, 'Facade', {
        deployOptions: { tracingEnabled: true },
      });
      this.api.root
        .addResource('invoke')
        .addMethod('POST', new apigateway.LambdaIntegration(this.worker), {
          apiKeyRequired: true,
          authorizationType: apigateway.AuthorizationType.NONE,
        });

      const key = this.api.addApiKey('DefaultKey');
      this.apiKey = key;
      this.usagePlan = this.api.addUsagePlan('UsagePlan', {
        throttle: {
          rateLimit: props.rateLimitRps ?? 10,
          burstLimit: props.burstLimit ?? 20,
        },
        ...(props.dailyQuota
          ? { quota: { limit: props.dailyQuota, period: apigateway.Period.DAY } }
          : {}),
      });
      this.usagePlan.addApiKey(key);
      this.usagePlan.addApiStage({ stage: this.api.deploymentStage });
    }
  }
}
