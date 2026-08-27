import * as events from 'aws-cdk-lib/aws-events';
import { Match } from 'aws-cdk-lib/assertions';
import { WireTap } from '../../lib';
import { assertAllBucketsSecure, makeStack, templateOf } from './helpers';

describe('WireTap', () => {
  function build() {
    const { stack } = makeStack();
    const bus = new events.EventBus(stack, 'Bus');
    new WireTap(stack, 'Wt', { eventBus: bus });
    return stack;
  }

  test('audit bucket + firehose + rule', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::S3::Bucket', 1);
    t.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 1);
    t.resourceCountIs('AWS::Events::Rule', 1);
  });

  test('bucket secure + versioned + lifecycle', () => {
    const t = templateOf(build());
    assertAllBucketsSecure(t);
    t.hasResourceProperties(
      'AWS::S3::Bucket',
      Match.objectLike({
        VersioningConfiguration: Match.objectLike({ Status: 'Enabled' }),
        LifecycleConfiguration: Match.anyValue(),
      }),
    );
  });

  test('firehose uses GZIP + date-partitioned prefix', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::KinesisFirehose::DeliveryStream',
      Match.objectLike({
        ExtendedS3DestinationConfiguration: Match.objectLike({
          CompressionFormat: 'GZIP',
          Prefix: Match.stringLikeRegexp('events/year=.*'),
        }),
      }),
    );
  });
});
