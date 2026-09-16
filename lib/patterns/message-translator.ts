import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqMaxReceive,
  dlqRetention,
  queueVisibilityFor,
} from '../types';

export interface MessageTranslatorProps extends BasePatternProps {
  /** Translator Lambda — reads source format, writes canonical format. */
  translatorHandler: string;
  translatorCode: lambda.Code;
  runtime?: lambda.Runtime;
  /** Source schema label surfaced as SOURCE_SCHEMA env (e.g. "xml/orders/v1"). */
  sourceSchema?: string;
  /** Target schema label surfaced as TARGET_SCHEMA env (e.g. "json/canonical-order/v2"). */
  targetSchema?: string;
  /** Optional Glue Schema Registry name + schema name surfaced as env for Powertools/validators. */
  schemaRegistryName?: string;
  schemaName?: string;
}

/**
 * Message Translator (EIP).
 *
 * Converts messages between formats — XML↔JSON, EDI segment↔canonical event,
 * partner schema↔internal schema. The construct provisions an input queue, a
 * translator Lambda (caller-supplied), and a canonical output queue.
 *
 * Schema labels are passed via env so the handler can pick the right mapper or
 * validate against AWS Glue Schema Registry.
 */
export class MessageTranslator extends Construct {
  public readonly inputQueue: sqs.Queue;
  public readonly outputQueue: sqs.Queue;
  public readonly translator: lambda.Function;

  constructor(scope: Construct, id: string, props: MessageTranslatorProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;

    const dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.inputQueue = new sqs.Queue(this, 'InputQueue', {
      visibilityTimeout: queueVisibilityFor(timeout),
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

    this.translator = new lambda.Function(this, 'Translator', {
      runtime: props.runtime ?? DEFAULT_LAMBDA_RUNTIME,
      handler: props.translatorHandler,
      code: props.translatorCode,
      timeout,
      logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
      environment: {
        OUTPUT_QUEUE_URL: this.outputQueue.queueUrl,
        ...(props.sourceSchema ? { SOURCE_SCHEMA: props.sourceSchema } : {}),
        ...(props.targetSchema ? { TARGET_SCHEMA: props.targetSchema } : {}),
        ...(props.schemaRegistryName ? { SCHEMA_REGISTRY_NAME: props.schemaRegistryName } : {}),
        ...(props.schemaName ? { SCHEMA_NAME: props.schemaName } : {}),
      },
    });
    this.translator.addEventSource(new lambdaEvents.SqsEventSource(this.inputQueue));
    this.outputQueue.grantSendMessages(this.translator);
  }
}
