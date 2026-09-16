import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Match } from 'aws-cdk-lib/assertions';
import { ApiCompositionApollo } from '../../lib';
import { makeStack, templateOf } from './helpers';

describe('ApiCompositionApollo', () => {
  test('creates Fargate service + ALB', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    new ApiCompositionApollo(stack, 'Apollo', {
      vpc,
      containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest'),
    });
    const t = templateOf(stack);
    t.resourceCountIs('AWS::ECS::Cluster', 1);
    t.resourceCountIs('AWS::ECS::Service', 1);
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  });

  test('exposes apollo health-check path', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    new ApiCompositionApollo(stack, 'Apollo', {
      vpc,
      containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest'),
    });
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::TargetGroup',
      Match.objectLike({ HealthCheckPath: '/.well-known/apollo/server-health' }),
    );
  });

  test('honours desiredCount', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    new ApiCompositionApollo(stack, 'Apollo', {
      vpc,
      containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest'),
      desiredCount: 4,
    });
    templateOf(stack).hasResourceProperties(
      'AWS::ECS::Service',
      Match.objectLike({ DesiredCount: 4 }),
    );
  });

  // The gateway must not be internet-facing by default, and must never be
  // internet-facing over plaintext HTTP.
  test('load balancer is internal by default', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    new ApiCompositionApollo(stack, 'Apollo', {
      vpc,
      containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest'),
    });
    templateOf(stack).hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::LoadBalancer',
      Match.objectLike({ Scheme: 'internal' }),
    );
  });

  test('default listener does not serve plaintext HTTP to the internet', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    new ApiCompositionApollo(stack, 'Apollo', {
      vpc,
      containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest'),
    });
    const t = templateOf(stack);
    const lbs = t.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer');
    for (const [, lb] of Object.entries(lbs)) {
      expect(lb.Properties?.Scheme).not.toBe('internet-facing');
    }
  });

  test('publicLoadBalancer without a certificate fails synth', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    expect(
      () =>
        new ApiCompositionApollo(stack, 'Apollo', {
          vpc,
          containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest'),
          publicLoadBalancer: true,
        }),
    ).toThrow(/plaintext HTTP/);
  });

  test('publicLoadBalancer with a certificate terminates HTTPS', () => {
    const { stack } = makeStack();
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const certificate = acm.Certificate.fromCertificateArn(
      stack,
      'Cert',
      'arn:aws:acm:us-east-1:111111111111:certificate/abc-123',
    );
    new ApiCompositionApollo(stack, 'Apollo', {
      vpc,
      containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest'),
      publicLoadBalancer: true,
      certificate,
    });
    const t = templateOf(stack);
    t.hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::LoadBalancer',
      Match.objectLike({ Scheme: 'internet-facing' }),
    );
    t.hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::Listener',
      Match.objectLike({ Protocol: 'HTTPS', Port: 443 }),
    );
  });
});
