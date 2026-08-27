import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
  dlqRetention,
} from '../types';

export interface RoutingRule {
  ruleName?: string;
  eventPattern: events.EventPattern;
  target: 'lambda' | 'sqs' | 'sns';
  lambdaConfig?: { handler: string; code: lambda.Code; runtime?: lambda.Runtime };
}

export interface ContentBasedRouterProps extends BasePatternProps {
  eventBusName?: string;
  rules: RoutingRule[];
}

/**
 * Content-Based Router (EIP)
 *
 * Inspects message content and routes to the appropriate channel based on
 * matching rules. Implemented via EventBridge event bus with pattern-matched rules.
 */
export class ContentBasedRouter extends Construct {
  public readonly eventBus: events.EventBus;
  public readonly dlq: sqs.Queue;
  public readonly rules: events.Rule[] = [];
  public readonly lambdaFunctions: lambda.Function[] = [];
  public readonly queues: sqs.Queue[] = [];
  public readonly topics: sns.Topic[] = [];

  constructor(scope: Construct, id: string, props: ContentBasedRouterProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: props.eventBusName,
    });

    this.dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: dlqRetention(props),
      removalPolicy: removal,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    for (const [i, ruleConfig] of props.rules.entries()) {
      const rule = new events.Rule(this, `Rule${i}`, {
        eventBus: this.eventBus,
        ruleName: ruleConfig.ruleName,
        eventPattern: ruleConfig.eventPattern,
      });
      this.rules.push(rule);

      if (ruleConfig.target === 'lambda' && ruleConfig.lambdaConfig) {
        const fn = new lambda.Function(this, `Fn${i}`, {
          runtime: ruleConfig.lambdaConfig.runtime ?? DEFAULT_LAMBDA_RUNTIME,
          handler: ruleConfig.lambdaConfig.handler,
          code: ruleConfig.lambdaConfig.code,
          timeout,
          logRetention,
        });
        this.lambdaFunctions.push(fn);
        rule.addTarget(new targets.LambdaFunction(fn, { deadLetterQueue: this.dlq }));
      } else if (ruleConfig.target === 'sqs') {
        const q = new sqs.Queue(this, `Queue${i}`, {
          removalPolicy: removal,
          enforceSSL: true,
          encryption: sqs.QueueEncryption.SQS_MANAGED,
        });
        this.queues.push(q);
        rule.addTarget(new targets.SqsQueue(q, { deadLetterQueue: this.dlq }));
      } else if (ruleConfig.target === 'sns') {
        const t = new sns.Topic(this, `Topic${i}`, { enforceSSL: true });
        this.topics.push(t);
        rule.addTarget(new targets.SnsTopic(t, { deadLetterQueue: this.dlq }));
      }
    }
  }
}
