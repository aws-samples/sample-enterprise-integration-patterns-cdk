import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { ContentEnricher } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('ContentEnricher', () => {
  test('without API: queues + enricher only', () => {
    const { stack } = makeStack();
    new ContentEnricher(stack, 'Ce', {
      enricherHandler: 'index.handler',
      enricherCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    const t = templateOf(stack);
    t.resourceCountIs('AWS::SQS::Queue', 3); // input, output, dlq
    assertPatternFunctionCount(t, 1);
    t.resourceCountIs('AWS::ApiGateway::RestApi', 0);
    assertAllQueuesSecure(t);
  });

  test('with API: defaults to IAM auth', () => {
    const { stack } = makeStack();
    new ContentEnricher(stack, 'Ce', {
      enricherHandler: 'index.handler',
      enricherCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      createApi: true,
    });
    const t = templateOf(stack);
    t.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    t.hasResourceProperties(
      'AWS::ApiGateway::Method',
      Match.objectLike({ AuthorizationType: 'AWS_IAM' }),
    );
  });
});
