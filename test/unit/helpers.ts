import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';

export function makeStack(): { app: App; stack: Stack } {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  return { app, stack };
}

export function templateOf(stack: Stack): Template {
  return Template.fromStack(stack);
}

/**
 * Asserts every SQS queue in the template has SSL enforcement and SQS-managed encryption.
 * No exceptions — every pattern in this library is supposed to set both.
 */
export function assertAllQueuesSecure(template: Template): void {
  const queues = template.findResources('AWS::SQS::Queue');
  for (const [logicalId, resource] of Object.entries(queues)) {
    const props = resource.Properties ?? {};
    expect(props.SqsManagedSseEnabled).toBe(true);
  }
  // Every queue must have a corresponding QueuePolicy enforcing SSL.
  const policies = template.findResources('AWS::SQS::QueuePolicy');
  const policyCount = Object.keys(policies).length;
  const queueCount = Object.keys(queues).length;
  expect(policyCount).toBeGreaterThanOrEqual(queueCount);
  for (const policy of Object.values(policies)) {
    const stmts = policy.Properties?.PolicyDocument?.Statement ?? [];
    const denyInsecure = stmts.find(
      (s: any) =>
        s.Effect === 'Deny' &&
        (s.Condition?.Bool?.['aws:SecureTransport'] === 'false' ||
          s.Condition?.Bool?.['aws:SecureTransport'] === false),
    );
    expect(denyInsecure).toBeDefined();
  }
}

/**
 * Asserts every S3 bucket has SSL enforcement, BlockPublicAccess all, and managed encryption.
 */
export function assertAllBucketsSecure(template: Template): void {
  const buckets = template.findResources('AWS::S3::Bucket');
  for (const [, resource] of Object.entries(buckets)) {
    const props = resource.Properties ?? {};
    expect(props.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    const sse = props.BucketEncryption?.ServerSideEncryptionConfiguration;
    expect(sse).toBeDefined();
    expect(sse.length).toBeGreaterThan(0);
  }
  // Every bucket should have a BucketPolicy denying non-SSL.
  const policies = template.findResources('AWS::S3::BucketPolicy');
  for (const policy of Object.values(policies)) {
    const stmts = policy.Properties?.PolicyDocument?.Statement ?? [];
    const denyInsecure = stmts.find(
      (s: any) =>
        s.Effect === 'Deny' &&
        s.Condition?.Bool?.['aws:SecureTransport'] === 'false',
    );
    expect(denyInsecure).toBeDefined();
  }
}

/**
 * Asserts every DynamoDB table has point-in-time recovery enabled.
 */
export function assertAllTablesPointInTimeRecovery(template: Template): void {
  const tables = template.findResources('AWS::DynamoDB::Table');
  for (const [, resource] of Object.entries(tables)) {
    const pitr = resource.Properties?.PointInTimeRecoverySpecification;
    expect(pitr?.PointInTimeRecoveryEnabled).toBe(true);
  }
  const tablesV2 = template.findResources('AWS::DynamoDB::GlobalTable');
  for (const [, resource] of Object.entries(tablesV2)) {
    // TableV2 PITR lives under each Replica's properties.
    const replicas = resource.Properties?.Replicas ?? [];
    for (const r of replicas) {
      expect(r.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled).toBe(true);
    }
  }
}

/**
 * Asserts a Lambda function exists with the given handler.
 */
export function assertLambdaWithHandler(template: Template, handler: string): void {
  template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({ Handler: handler }));
}

/**
 * Logical-ID patterns for Lambda functions the CDK injects itself, rather than
 * ones a pattern construct deliberately creates.
 *
 * These exist because a construct opted into a feature that needs a custom
 * resource behind it — `logRetention` on a Function produces a LogRetention
 * provider, `autoDeleteObjects` on a Bucket produces an AutoDeleteObjects
 * provider. They are an implementation detail of aws-cdk-lib and their number
 * and naming change between CDK releases, so asserting on them would couple
 * these tests to CDK internals.
 */
const CDK_MANAGED_FUNCTION_IDS: RegExp[] = [
  /^LogRetention[0-9a-f]*$/i,
  /CustomResourceProviderHandler/,
  /^Custom[A-Za-z0-9]+CustomResourceProvider/,
  /framework(OnEvent|OnTimeout|IsComplete)/i,
  /^BucketNotificationsHandler/,
];

function isCdkManagedFunction(logicalId: string): boolean {
  return CDK_MANAGED_FUNCTION_IDS.some((re) => re.test(logicalId));
}

/**
 * Every Lambda function the construct under test created, excluding the provider
 * functions CDK adds for its own custom resources.
 */
export function patternFunctions(template: Template): Record<string, any> {
  const all = template.findResources('AWS::Lambda::Function');
  return Object.fromEntries(
    Object.entries(all).filter(([logicalId]) => !isCdkManagedFunction(logicalId)),
  );
}

/**
 * Asserts how many Lambda functions the pattern itself created.
 *
 * Use this instead of `template.resourceCountIs('AWS::Lambda::Function', n)`, which
 * also counts CDK's own custom-resource providers and therefore breaks whenever CDK
 * changes how many of those it emits.
 *
 * On failure it names the functions it found on both sides of the filter, so the
 * cause is obvious rather than being an opaque number mismatch.
 */
export function assertPatternFunctionCount(template: Template, expected: number): void {
  const all = template.findResources('AWS::Lambda::Function');
  const owned = Object.keys(all).filter((id) => !isCdkManagedFunction(id));
  const managed = Object.keys(all).filter((id) => isCdkManagedFunction(id));
  if (owned.length !== expected) {
    throw new Error(
      `Expected the pattern to create ${expected} Lambda function(s) but found ${owned.length}.\n` +
        `  pattern-owned: ${owned.length ? owned.join(', ') : '(none)'}\n` +
        `  cdk-managed (excluded): ${managed.length ? managed.join(', ') : '(none)'}`,
    );
  }
  expect(owned.length).toBe(expected);
}

/**
 * Asserts the count of resources of a given type matches expected.
 */
export function assertResourceCount(template: Template, type: string, count: number): void {
  template.resourceCountIs(type, count);
}

/**
 * Asserts every SQS queue has a redrive policy pointing at a DLQ.
 * Pass excludeLogicalIdRegex to skip queues that are themselves DLQs.
 */
export function assertQueuesHaveDlq(
  template: Template,
  options: { excludeMatcher?: (logicalId: string) => boolean } = {},
): void {
  const queues = template.findResources('AWS::SQS::Queue');
  const skip = options.excludeMatcher ?? ((id) => /Dlq|DLQ/.test(id));
  for (const [logicalId, resource] of Object.entries(queues)) {
    if (skip(logicalId)) continue;
    const redrive = resource.Properties?.RedrivePolicy;
    expect(redrive).toBeDefined();
    expect(redrive.maxReceiveCount).toBeGreaterThanOrEqual(1);
  }
}
