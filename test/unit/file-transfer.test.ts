import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { FileTransfer } from '../../lib';
import {
  assertAllBucketsSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('FileTransfer', () => {
  test('without ingestion lambda — bucket + server + role + rule', () => {
    const { stack } = makeStack();
    new FileTransfer(stack, 'Ft', {});
    const t = templateOf(stack);
    t.resourceCountIs('AWS::S3::Bucket', 1);
    t.resourceCountIs('AWS::Transfer::Server', 1);
    t.resourceCountIs('AWS::Events::Rule', 1);
    // Assert the Transfer user role by its trust policy rather than counting roles:
    // the template also contains CDK-managed provider roles, and how many of those
    // CDK emits is an implementation detail.
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: Match.objectLike({ Service: 'transfer.amazonaws.com' }),
            }),
          ]),
        }),
      }),
    );
    assertPatternFunctionCount(t, 0);
  });

  test('with ingestion lambda — adds Lambda + grants read', () => {
    const { stack } = makeStack();
    new FileTransfer(stack, 'Ft', {
      ingestionHandler: 'index.handler',
      ingestionCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    const t = templateOf(stack);
    assertPatternFunctionCount(t, 1);
  });

  test('bucket has eventBridgeEnabled + secure defaults', () => {
    const { stack } = makeStack();
    new FileTransfer(stack, 'Ft', {});
    const t = templateOf(stack);
    assertAllBucketsSecure(t);
    // CDK does not render bucket notifications inline on AWS::S3::Bucket. Because
    // CloudFormation's NotificationConfiguration is all-or-nothing, CDK routes it
    // through a Custom::S3BucketNotifications resource instead, so that is where
    // eventBridgeEnabled: true shows up.
    t.hasResourceProperties(
      'Custom::S3BucketNotifications',
      Match.objectLike({
        NotificationConfiguration: Match.objectLike({
          EventBridgeConfiguration: Match.anyValue(),
        }),
      }),
    );
  });

  test('server protocol defaults to SFTP', () => {
    const { stack } = makeStack();
    new FileTransfer(stack, 'Ft', {});
    templateOf(stack).hasResourceProperties(
      'AWS::Transfer::Server',
      Match.objectLike({ Protocols: ['SFTP'] }),
    );
  });
});
