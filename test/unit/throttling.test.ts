import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { Throttling } from '../../lib';
import { assertAllQueuesSecure, makeStack, templateOf } from './helpers';

describe('Throttling', () => {
  function build(createApi = true) {
    const { stack } = makeStack();
    new Throttling(stack, 'Th', {
      workerHandler: 'index.handler',
      workerCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      workerReservedConcurrency: 5,
      createApi,
      rateLimitRps: 50,
      burstLimit: 100,
      dailyQuota: 1_000_000,
    });
    return stack;
  }

  test('without API — queue + worker only', () => {
    const t = templateOf(build(false));
    t.resourceCountIs('AWS::ApiGateway::RestApi', 0);
    t.resourceCountIs('AWS::SQS::Queue', 2);
  });

  test('worker has reserved concurrency', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({ ReservedConcurrentExecutions: 5 }),
    );
  });

  test('with API — usage plan + key + quota', () => {
    const t = templateOf(build(true));
    t.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    t.resourceCountIs('AWS::ApiGateway::UsagePlan', 1);
    t.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
    t.hasResourceProperties(
      'AWS::ApiGateway::UsagePlan',
      Match.objectLike({
        Throttle: Match.objectLike({ RateLimit: 50, BurstLimit: 100 }),
        Quota: Match.objectLike({ Limit: 1_000_000, Period: 'DAY' }),
      }),
    );
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });
});
