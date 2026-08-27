import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { BasePatternProps } from '../types';

export interface WireTapProps extends BasePatternProps {
  /** Existing event bus to tap. The construct adds a rule that mirrors matched events. */
  eventBus: events.IEventBus;
  /** Pattern selecting events to mirror. Omit to tap everything on the bus. */
  eventPattern?: events.EventPattern;
  /** Object expiration on the audit bucket. Default: 365 days. */
  archiveExpirationDays?: number;
}

/**
 * Wire Tap (EIP)
 *
 * Mirrors traffic on an EventBridge bus to an S3 archive via Firehose without
 * disrupting downstream consumers. Compliance- and audit-friendly.
 */
export class WireTap extends Construct {
  public readonly archiveBucket: s3.Bucket;
  public readonly deliveryStream: firehose.CfnDeliveryStream;
  public readonly rule: events.Rule;

  constructor(scope: Construct, id: string, props: WireTapProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;

    this.archiveBucket = new s3.Bucket(this, 'AuditBucket', {
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: Duration.days(props.archiveExpirationDays ?? 365) }],
    });

    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    this.archiveBucket.grantReadWrite(firehoseRole);

    this.deliveryStream = new firehose.CfnDeliveryStream(this, 'AuditStream', {
      deliveryStreamType: 'DirectPut',
      extendedS3DestinationConfiguration: {
        bucketArn: this.archiveBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        bufferingHints: { intervalInSeconds: 60, sizeInMBs: 5 },
        compressionFormat: 'GZIP',
        prefix: 'events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/',
      },
    });

    this.rule = new events.Rule(this, 'TapRule', {
      eventBus: props.eventBus,
      eventPattern: props.eventPattern ?? { source: [{ prefix: '' } as unknown as string] },
      // ASCII only: CloudFormation restricts Description to \u0020-\u00FF.
      description: 'Wire Tap - mirrors events to audit Firehose',
    });
    this.rule.addTarget(
      new targets.KinesisFirehoseStream(this.deliveryStream as unknown as firehose.CfnDeliveryStream),
    );
  }
}
