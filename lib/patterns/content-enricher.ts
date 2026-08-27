import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
} from '../types';

export interface ContentEnricherProps extends BasePatternProps {
  enricherHandler: string;
  enricherCode: lambda.Code;
  runtime?: lambda.Runtime;
  createApi?: boolean;
  /** Authorizer for the optional API. Required when createApi is true; pass IamAuthorizer if no custom authorizer is needed. */
  apiAuthorizer?: apigateway.IAuthorizer;
  /** When createApi is true and no authorizer is set, default to IAM auth instead of unauthenticated. */
  apiAuthorizationType?: apigateway.AuthorizationType;
}

export class ContentEnricher extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly outputQueue: sqs.Queue;
  public readonly enricher: lambda.Function;
  public readonly api?: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ContentEnricherProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    const dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.inputQueue = new sqs.Queue(this, 'InputQueue', {
      deadLetterQueue: { queue: dlq, maxReceiveCount: dlqMaxReceive(props) },
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.outputQueue = new sqs.Queue(this, 'OutputQueue', {
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.enricher = new lambda.Function(this, 'Enricher', {
      runtime: props.runtime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.enricherHandler,
      code: props.enricherCode,
      timeout,
      logRetention,
      environment: { OUTPUT_QUEUE_URL: this.outputQueue.queueUrl },
    });
    this.enricher.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.outputQueue.grantSendMessages(this.enricher);

    if (props.createApi) {
      this.api = new apigateway.RestApi(this, 'EnricherApi', {
        deployOptions: { tracingEnabled: true },
      });
      const authorizationType = props.apiAuthorizer
        ? apigateway.AuthorizationType.CUSTOM
        : props.apiAuthorizationType ?? apigateway.AuthorizationType.IAM;
      this.api.root
        .addResource('enrich')
        .addMethod('POST', new apigateway.LambdaIntegration(this.enricher), {
          authorizationType,
          authorizer: props.apiAuthorizer,
        });
    }
  }
}
