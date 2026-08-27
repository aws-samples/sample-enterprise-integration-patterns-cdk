import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ClaimCheck } from '../../lib';
import {
  assertAllBucketsSecure,
  assertAllQueuesSecure,
  assertPatternFunctionCount,
  makeStack,
  templateOf,
} from './helpers';

describe('ClaimCheck', () => {
  function build() {
    const { stack } = makeStack();
    new ClaimCheck(stack, 'Cc', {
      checkinHandler: 'index.handler',
      checkinCode: lambda.Code.fromInline('exports.handler = async () => {};'),
      checkoutHandler: 'index.handler',
      checkoutCode: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
    return stack;
  }

  test('creates bucket + input/output queues + dlq + 2 lambdas', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::S3::Bucket', 1);
    t.resourceCountIs('AWS::SQS::Queue', 3);
    assertPatternFunctionCount(t, 2);
  });

  test('bucket and queues secure', () => {
    const t = templateOf(build());
    assertAllBucketsSecure(t);
    assertAllQueuesSecure(t);
  });
});
