import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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

  // An API key identifies a caller against a usage plan; it does not authenticate
  // them. The facade must therefore never synthesize with AuthorizationType NONE.
  test('API facade defaults to IAM authorization, not NONE', () => {
    const t = templateOf(build(true));
    t.hasResourceProperties(
      'AWS::ApiGateway::Method',
      Match.objectLike({
        HttpMethod: 'POST',
        AuthorizationType: 'AWS_IAM',
        ApiKeyRequired: true,
      }),
    );
  });

  test('no API method is left unauthenticated', () => {
    const methods = templateOf(build(true)).findResources('AWS::ApiGateway::Method');
    const methodList = Object.entries(methods);
    expect(methodList.length).toBeGreaterThan(0);
    for (const [logicalId, resource] of methodList) {
      if (resource.Properties?.HttpMethod === 'OPTIONS') continue;
      expect(resource.Properties?.AuthorizationType).not.toBe('NONE');
    }
  });

  test('an explicit authorizer switches the method to CUSTOM', () => {
    const { stack } = makeStack();
    const authFn = new lambda.Function(stack, 'AuthFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    const authorizer = new apigateway.TokenAuthorizer(stack, 'Authorizer', {
      handler: authFn,
    });
    new Throttling(stack, 'Th', {
      workerHandler: 'index.handler',
      workerCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      workerReservedConcurrency: 5,
      createApi: true,
      apiAuthorizer: authorizer,
    });
    templateOf(stack).hasResourceProperties(
      'AWS::ApiGateway::Method',
      Match.objectLike({ HttpMethod: 'POST', AuthorizationType: 'CUSTOM' }),
    );
  });
});
