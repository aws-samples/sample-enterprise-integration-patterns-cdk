import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as transfer from 'aws-cdk-lib/aws-transfer';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
} from '../types';

export interface FileTransferProps extends BasePatternProps {
  /** Friendly name surfaced on the Transfer Family server. */
  serverName?: string;
  /** SFTP / FTPS / FTP. Default: SFTP. */
  protocol?: 'SFTP' | 'FTPS' | 'FTP';
  /** Object retention on the landing bucket (days). Default: 30. */
  fileRetentionDays?: number;
  /** Optional ingestion handler invoked when a new object lands. */
  ingestionHandler?: string;
  ingestionCode?: lambda.Code;
  ingestionRuntime?: lambda.Runtime;
}

/**
 * File Transfer (EIP integration style).
 *
 * AWS Transfer Family server (SFTP by default) writes to an S3 landing bucket;
 * S3 events fan out to EventBridge; an optional ingestion Lambda processes new
 * arrivals. Replaces SFTP-based legacy B2B file drops.
 *
 * User provisioning is intentionally out of scope: callers add SFTP users via
 * `transfer.CfnUser` referencing `server.attrServerId`. This keeps credentials
 * out of the construct's blast radius.
 */
export class FileTransfer extends Construct {
  public readonly landingBucket: s3.Bucket;
  public readonly server: transfer.CfnServer;
  public readonly userRole: iam.Role;
  public readonly arrivalRule: events.Rule;
  public readonly ingestionFunction?: lambda.Function;

  constructor(scope: Construct, id: string, props: FileTransferProps = {}) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;

    this.landingBucket = new s3.Bucket(this, 'LandingBucket', {
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      eventBridgeEnabled: true,
      lifecycleRules: [{ expiration: Duration.days(props.fileRetentionDays ?? 30) }],
    });

    this.userRole = new iam.Role(this, 'TransferUserRole', {
      assumedBy: new iam.ServicePrincipal('transfer.amazonaws.com'),
      // ASCII only: CloudFormation restricts Description to \u0020-\u00FF, so an
      // em dash here fails template validation.
      description: 'Assumed by Transfer Family users - read/write to landing bucket only.',
    });
    this.landingBucket.grantReadWrite(this.userRole);

    this.server = new transfer.CfnServer(this, 'Server', {
      protocols: [props.protocol ?? 'SFTP'],
      domain: 'S3',
      endpointType: 'PUBLIC',
      identityProviderType: 'SERVICE_MANAGED',
      tags: [{ key: 'Name', value: props.serverName ?? `${id}-sftp` }],
    });

    this.arrivalRule = new events.Rule(this, 'ArrivalRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: { bucket: { name: [this.landingBucket.bucketName] } },
      },
    });

    if (props.ingestionHandler && props.ingestionCode) {
      this.ingestionFunction = new lambda.Function(this, 'Ingestion', {
        runtime: props.ingestionRuntime ?? DEFAULT_LAMBDA_RUNTIME,
        handler: props.ingestionHandler,
        code: props.ingestionCode,
        timeout: props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT,
        logRetention: props.logRetention ?? DEFAULT_LOG_RETENTION,
        environment: { LANDING_BUCKET: this.landingBucket.bucketName },
      });
      this.landingBucket.grantRead(this.ingestionFunction);
      this.arrivalRule.addTarget(new targets.LambdaFunction(this.ingestionFunction));
    }
  }
}
