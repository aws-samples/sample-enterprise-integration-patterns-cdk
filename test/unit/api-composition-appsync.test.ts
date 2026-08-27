import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import * as path from 'path';
import { ApiCompositionAppSync } from '../../lib';
import {
  assertAllTablesPointInTimeRecovery,
  makeStack,
  templateOf,
} from './helpers';
import * as fs from 'fs';
import * as os from 'os';

describe('ApiCompositionAppSync', () => {
  function withSchema<T>(fn: (schemaPath: string) => T): T {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eip-test-'));
    const file = path.join(tmp, 'schema.graphql');
    fs.writeFileSync(file, 'type Query { hello: String }\n');
    try {
      return fn(file);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  test('default auth is IAM', () => {
    withSchema((schemaPath) => {
      const { stack } = makeStack();
      new ApiCompositionAppSync(stack, 'Api', {
        schemaPath,
        resolvers: [],
      });
      const t = templateOf(stack);
      t.hasResourceProperties(
        'AWS::AppSync::GraphQLApi',
        Match.objectLike({ AuthenticationType: 'AWS_IAM' }),
      );
    });
  });

  test('lambda + dynamo resolvers create data sources', () => {
    withSchema((schemaPath) => {
      const { stack } = makeStack();
      new ApiCompositionAppSync(stack, 'Api', {
        schemaPath,
        resolvers: [
          {
            typeName: 'Query',
            fieldName: 'getThing',
            kind: 'lambda',
            lambdaConfig: {
              handler: 'index.handler',
              code: lambda.Code.fromInline('exports.handler = async () => {};'),
            },
          },
          { typeName: 'Query', fieldName: 'getOther', kind: 'dynamodb' },
        ],
      });
      const t = templateOf(stack);
      t.resourceCountIs('AWS::AppSync::DataSource', 2);
      t.resourceCountIs('AWS::DynamoDB::Table', 1);
      assertAllTablesPointInTimeRecovery(t);
    });
  });

  test('xray enabled', () => {
    withSchema((schemaPath) => {
      const { stack } = makeStack();
      new ApiCompositionAppSync(stack, 'Api', { schemaPath, resolvers: [] });
      templateOf(stack).hasResourceProperties(
        'AWS::AppSync::GraphQLApi',
        Match.objectLike({ XrayEnabled: true }),
      );
    });
  });
});
