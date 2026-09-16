import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { BasePatternProps } from '../types';

export interface ApiCompositionApolloProps extends BasePatternProps {
  vpc: ec2.IVpc;
  containerImage: ecs.ContainerImage;
  cpu?: number;
  memoryLimitMiB?: number;
  desiredCount?: number;
  /** When provided, the load balancer terminates HTTPS and redirects HTTP→HTTPS. Required when publicLoadBalancer is true. */
  certificate?: acm.ICertificate;
  /**
   * Default: false — the gateway is internal to the VPC.
   *
   * Setting this to true requires a `certificate`; synthesis fails otherwise,
   * because an internet-facing listener without one serves plaintext GraphQL.
   */
  publicLoadBalancer?: boolean;
}

export class ApiCompositionApollo extends Construct {
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: ApiCompositionApolloProps) {
    super(scope, id);

    // Internal by default. An internet-facing ALB without a certificate would
    // serve unencrypted GraphQL to the world, so that combination is refused
    // rather than silently deployed.
    const publicLoadBalancer = props.publicLoadBalancer ?? false;
    if (publicLoadBalancer && !props.certificate) {
      throw new Error(
        'ApiCompositionApollo: publicLoadBalancer is true but no certificate was supplied, ' +
          'which would expose the Apollo gateway over plaintext HTTP. Pass a `certificate` to ' +
          'terminate HTTPS, or leave publicLoadBalancer unset to keep the gateway internal.',
      );
    }

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Gateway', {
      vpc: props.vpc,
      cpu: props.cpu ?? 256,
      memoryLimitMiB: props.memoryLimitMiB ?? 512,
      desiredCount: props.desiredCount ?? 2,
      taskImageOptions: {
        image: props.containerImage,
        containerPort: 4000,
      },
      publicLoadBalancer,
      ...(props.certificate
        ? {
            certificate: props.certificate,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            redirectHTTP: true,
          }
        : {}),
    });

    this.service.targetGroup.configureHealthCheck({ path: '/.well-known/apollo/server-health' });
  }
}
