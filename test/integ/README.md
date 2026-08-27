# Hosted Integration Tests

These tests deploy real CDK stacks to an AWS sandbox account, exercise the deployed patterns end-to-end, and tear them down. They are **not** run by default — they cost money and require live AWS credentials.

## Prerequisites

1. AWS CLI authenticated against a non-production sandbox account.
2. CDK bootstrapped in that account/region: `npx cdk bootstrap`.
3. Environment variables:
   - `AWS_REGION` — region to deploy into (e.g., `us-east-1`).
   - `INTEG_TEST_ACCOUNT` — account ID of your sandbox (used as a guard).
   - `RUN_HOSTED_INTEG=1` — opt-in flag. Tests skip if absent.

## Running

```bash
# Run all hosted integration tests (slow — minutes per test, costs money)
RUN_HOSTED_INTEG=1 AWS_REGION=us-east-1 INTEG_TEST_ACCOUNT=123456789012 npm run test:integ

# Run a single test
RUN_HOSTED_INTEG=1 AWS_REGION=us-east-1 INTEG_TEST_ACCOUNT=123456789012 \
  npx jest test/integ/request-reply.integ.test.ts
```

## What's covered

The hosted suite exercises three representative patterns end-to-end:

- `request-reply.integ.test.ts` — sends a request, asserts a correlated reply lands on the reply queue.
- `publish-subscribe-sns.integ.test.ts` — publishes to the topic, asserts every subscriber queue receives the message.
- `saga-orchestration.integ.test.ts` — starts an execution, asserts the state machine reaches Succeeded.

Three tests is the right number for the harness: enough to prove the wiring works on a real account, few enough to keep the suite tractable. The CDK assertion suite covers per-pattern correctness; the hosted suite covers the parts assertions can't (real IAM evaluation, real event source mappings, real Step Functions execution).

## Cost

Each test deploys, runs ~30s of activity, and tears down. Round-trip cost per test is dollars in the low single digits. Run on a schedule (e.g., nightly) rather than on every PR.

## Teardown safety

Every test uses `RemovalPolicy.DESTROY` and `autoDeleteObjects` so the cleanup phase fully destroys the stack. If a test fails mid-way, manually destroy the stack via `npx cdk destroy <stack-name>` to avoid orphan resources.
