import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Match } from 'aws-cdk-lib/assertions';
import { RequestReplyLargePayload } from '../../lib';
import {
  assertAllBucketsSecure,
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('RequestReplyLargePayload', () => {
  function build() {
    const { stack } = makeStack();
    new RequestReplyLargePayload(stack, 'Rrlp', {
      consumerHandler: 'index.handler',
      consumerCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    return stack;
  }

  test('creates payload bucket + queues + consumer', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::S3::Bucket', 1);
    t.resourceCountIs('AWS::SQS::Queue', 4);
    assertPatternFunctionCount(t, 1);
  });

  test('bucket secure with lifecycle expiration', () => {
    const t = templateOf(build());
    assertAllBucketsSecure(t);
    t.hasResourceProperties(
      'AWS::S3::Bucket',
      Match.objectLike({
        LifecycleConfiguration: Match.objectLike({
          Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 7 })]),
        }),
      }),
    );
  });

  test('queues secure', () => {
    assertAllQueuesSecure(templateOf(build()));
  });

  test('consumer has bucket env + read/write permissions', () => {
    const t = templateOf(build());
    t.hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            REPLY_QUEUE_URL: Match.anyValue(),
            PAYLOAD_BUCKET: Match.anyValue(),
          }),
        }),
      }),
    );
  });
});
