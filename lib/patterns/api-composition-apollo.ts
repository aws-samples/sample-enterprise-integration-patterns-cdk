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
  /** When provided, the load balancer terminates HTTPS and redirects HTTP→HTTPS. Strongly recommended for any non-internal exposure. */
  certificate?: acm.ICertificate;
  /** Default: true. Set false to keep the gateway internal — recommended unless edge auth is in front. */
  publicLoadBalancer?: boolean;
}

export class ApiCompositionApollo extends Construct {
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: ApiCompositionApolloProps) {
    super(scope, id);

    const publicLoadBalancer = props.publicLoadBalancer ?? true;

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
