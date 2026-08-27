import { Match } from 'aws-cdk-lib/assertions';
import { Outbox } from '../../lib';
import {
  assertAllQueuesSecure,
  assertAllTablesPointInTimeRecovery,
  makeStack,
  templateOf,
} from './helpers';

describe('Outbox', () => {
  function build() {
    const { stack } = makeStack();
    new Outbox(stack, 'Outbox');
    return stack;
  }

  test('creates outbox table + topic + pipe + DLQ', () => {
    const t = templateOf(build());
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    t.resourceCountIs('AWS::SNS::Topic', 1);
    t.resourceCountIs('AWS::Pipes::Pipe', 1);
    t.resourceCountIs('AWS::SQS::Queue', 1);
  });

  test('table has streams enabled with NEW_IMAGE', () => {
    templateOf(build()).hasResourceProperties(
      'AWS::DynamoDB::Table',
      Match.objectLike({
        StreamSpecification: Match.objectLike({ StreamViewType: 'NEW_IMAGE' }),
      }),
    );
  });

  test('pipe filters on INSERT only', () => {
    const t = templateOf(build());
    const pipes = t.findResources('AWS::Pipes::Pipe');
    const pipe = Object.values(pipes)[0] as any;
    const filters = pipe.Properties.SourceParameters.FilterCriteria.Filters;
    expect(filters[0].Pattern).toContain('INSERT');
  });

  test('queues secure + table PITR', () => {
    const t = templateOf(build());
    assertAllQueuesSecure(t);
    assertAllTablesPointInTimeRecovery(t);
  });
});
