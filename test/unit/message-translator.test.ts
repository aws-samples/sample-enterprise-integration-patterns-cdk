import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { MessageTranslator } from '../../lib';
import {
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('MessageTranslator', () => {
  function build() {
    const { stack } = makeStack();
    new MessageTranslator(stack, 'Mt', {
      translatorHandler: 'index.handler',
      translatorCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      sourceSchema: 'xml/v1',
      targetSchema: 'json/v2',
      schemaRegistryName: 'reg',
      schemaName: 'CanonOrder',
    });
    return stack;
  }

  test('input/output queues + dlq + translator', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::SQS::Queue', 3);
    assertPatternFunctionCount(t, 1);
  });

  test('translator gets schema env vars', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            SOURCE_SCHEMA: 'xml/v1',
            TARGET_SCHEMA: 'json/v2',
            SCHEMA_REGISTRY_NAME: 'reg',
            SCHEMA_NAME: 'CanonOrder',
          }),
        }),
      }),
    );
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });
});
