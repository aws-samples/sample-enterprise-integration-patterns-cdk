import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
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
});
