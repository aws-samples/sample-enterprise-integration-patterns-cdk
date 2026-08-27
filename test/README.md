# Tests

Two-tier test suite for the deterministic EIP construct library.

## Tier 1 — CDK assertion tests (`test/unit/`)

Fast Jest tests using `aws-cdk-lib/assertions`. They synthesise each construct into CloudFormation and assert on the result: resource counts, IAM policies, encryption defaults, DLQ wiring, secure transport enforcement, env vars, IAM least privilege.

- Runs in seconds.
- No AWS account required.
- Run on every PR via `npm test`.
- Coverage gate: 80% lines / 70% branches.

One test file per construct. Shared assertion helpers live in `test/unit/helpers.ts` (`assertAllQueuesSecure`, `assertAllBucketsSecure`, `assertAllTablesPointInTimeRecovery`, etc.).

## Tier 2 — Hosted integration tests (`test/integ/`)

Real CDK deployments to a sandbox AWS account. Each test:
1. Synthesises a small inline CDK app that uses a construct.
2. Deploys it via `cdk deploy`.
3. Runs end-to-end stimulus + assertion (send a message, poll for a result, verify state machine status).
4. Tears down via `cdk destroy`.

- Runs in minutes per test.
- Requires AWS credentials + CDK bootstrap.
- Costs money (low single-digit dollars per run).
- Opt-in via `RUN_HOSTED_INTEG=1`. Otherwise the suite is `describe.skip`-ed.
- Run nightly or on merge to main, not on every PR.

Three representative tests cover the patterns whose end-to-end correctness can't be proven by CFN assertions alone:

- `request-reply.integ.test.ts` — full request/correlation/reply round trip.
- `publish-subscribe-sns.integ.test.ts` — fan-out delivery to all subscriber queues.
- `saga-orchestration.integ.test.ts` — Step Functions execution reaches Succeeded.

The Tier 1 suite covers per-pattern wiring; Tier 2 covers the live runtime behaviour assertions can't reach.

## Running

```bash
# Tier 1 only — fast, no AWS
npm test

# Tier 2 — slow, requires AWS sandbox
RUN_HOSTED_INTEG=1 \
  AWS_REGION=us-east-1 \
  INTEG_TEST_ACCOUNT=123456789012 \
  npm run test:integ

# Both tiers
RUN_HOSTED_INTEG=1 ... npm run test:all
```

## What's not covered

- **Performance / load testing.** Out of scope. Use a separate Artillery / Locust harness against a deployed stack.
- **Drift / chaos testing.** Out of scope. Use AWS Fault Injection Simulator on a deployed stack.
- **Eval suites for agentic patterns.** Belongs in the agentic library's own test tree.

## Adding a new construct

1. Create `test/unit/<construct>.test.ts` mirroring the convention of an existing test (e.g., `test/unit/request-reply.test.ts`).
2. Use the helpers — `assertAllQueuesSecure` and friends — for security-default assertions.
3. Cover: resource counts, key configuration props (env vars, encryption, DLQ wiring), IAM least privilege, anti-pattern errors that the construct rejects.
4. If the construct exposes runtime behaviour worth proving end-to-end, add a hosted test under `test/integ/<construct>.integ.test.ts`.
