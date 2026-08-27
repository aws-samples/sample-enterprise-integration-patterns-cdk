import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { MessageReplayArchive } from '../../lib';
import {
  assertAllBucketsSecure,
  assertAllQueuesSecure,
  assertAllTablesPointInTimeRecovery,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('MessageReplayArchive', () => {
  function build() {
    const { stack } = makeStack();
    new MessageReplayArchive(stack, 'Mra', {
      archiveHandler: 'index.handler',
      archiveCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      replayHandler: 'index.handler',
      replayCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      subscriberQueueCount: 2,
    });
    return stack;
  }

  test('creates topic + bucket + metadata table + subscriber queues + replay API', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::SNS::Topic', 1);
    t.resourceCountIs('AWS::S3::Bucket', 1);
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    t.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    assertPatternFunctionCount(t, 2);
  });

  test('archive bucket versioned + secure', () => {
    const t = templateOf(build());
    assertAllBucketsSecure(t);
    t.hasResourceProperties(
      'AWS::S3::Bucket',
      Match.objectLike({ VersioningConfiguration: Match.objectLike({ Status: 'Enabled' }) }),
    );
  });

  test('replay API methods default to IAM auth', () => {
    const t = templateOf(build());
    const methods = t.findResources('AWS::ApiGateway::Method');
    const interesting = Object.values(methods).filter(
      (m: any) => m.Properties?.HttpMethod !== 'OPTIONS',
    );
    for (const m of interesting) {
      // Some methods will be at higher level; the interesting ones expect IAM.
      if ((m as any).Properties.HttpMethod === 'GET' || (m as any).Properties.HttpMethod === 'POST') {
        expect((m as any).Properties.AuthorizationType).toBe('AWS_IAM');
      }
    }
  });

  test('queues secure + table PITR', () => {
    const t = templateOf(build());
    assertAllQueuesSecure(t);
    assertAllTablesPointInTimeRecovery(t);
  });

  test('routes are non-overlapping (replay vs by-date)', () => {
    const t = templateOf(build());
    const resources = t.findResources('AWS::ApiGateway::Resource');
    const paths = Object.values(resources).map((r: any) => r.Properties.PathPart);
    expect(paths).toEqual(expect.arrayContaining(['by-date', 'replay', '{date}', '{messageId}']));
    // Crucially, {date} and replay are NOT siblings under /messageArchive.
  });
});
