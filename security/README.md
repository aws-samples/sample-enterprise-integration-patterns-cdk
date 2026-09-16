# Security scanning

Two checks, both reproducible from a clean clone.

```bash
npm ci
npm run security:audit          # npm audit — third-party dependency advisories
npm run security:nag:summary    # cdk-nag AwsSolutions pack over every construct
```

## Why there is a harness

cdk-nag inspects the CloudFormation a CDK app synthesizes. `bin/app.ts` is deliberately an
empty stub, so pointing cdk-nag at it produces no templates and therefore no findings — a
clean report that scanned nothing. `cdk-nag-app.ts` exists so there is always something real
to scan: it declares each of the 29 patterns exported from `lib/` once, in its own stack, and
applies the `AwsSolutionsChecks` rule pack.

Constructs are built with their **default** props wherever a required prop does not force a
choice. That is deliberate — the report should reflect what a consumer gets out of the box,
not what a hardened configuration could achieve.

`npm run security:nag` exits non-zero when there are error-level findings. That is cdk-nag
working as designed, not a broken build.

## Reading the output

`nag.out/` holds one `AwsSolutions-<Stack>-NagReport.csv` per pattern. The summary rolls them
up by rule and by pattern:

```bash
node security/summarize-nag.mjs nag.out                     # human-readable
node security/summarize-nag.mjs nag.out --json              # machine-readable
node security/summarize-nag.mjs nag.out --csv findings.csv   # all non-compliant rows
```

Resources named `Shared*` are prerequisites the harness creates to satisfy required props —
a VPC, a secret, a security group, an event bus. They are not part of the library, so the
summary counts them separately. A VPC flow-log finding against `SharedVpc` is a property of
the harness, not of the construct under test.

## What the findings mean

Most remaining findings are deliberate boundaries rather than defects, and consumers are
expected to close them for their own environment:

| Rule | What it wants | Why it is still open |
|---|---|---|
| `IAM4` / `IAM5` | No AWS managed policies, no wildcard resources | Produced by CDK's own `grant*` helpers and service roles. One deliberate wildcard: `PublishSubscribeMq` grants the six `ec2:*NetworkInterface*`/`ec2:Describe*` actions Lambda's MQ event source requires on `*`, because those actions do not support resource-level scoping |
| `SQS3` | Every queue has a DLQ | Fires on the DLQs themselves, which by definition have none |
| `COG4` | A Cognito user pool authorizer | The API patterns default to IAM auth; Cognito is a consumer choice |
| `APIG1` / `APIG6` | Access and execution logging | Log destinations are account-specific |
| `APIG3` | WAFv2 web ACL on the stage | A web ACL is an account-level resource |
| `S1` | S3 server access logs | Target bucket is a consumer choice |
| `SF1` | Step Functions logs all events | Log group is a consumer choice |
| `ELB2` | ALB access logs | Target bucket is a consumer choice |
| `EC23` | No `0.0.0.0/0` inbound | The ALB listener SG; note the ALB is internal by default |
| `VPC7`, `SMG4`, `ECS4` | Flow logs, secret rotation, Container Insights | Raised against harness prerequisites, not library resources |

The library-level gaps a team must close before production are listed in the README and in
`skills/integration-discovery/references/interface-assessment-template.md`: no CloudWatch
alarms, no customer-managed KMS keys, no encryption at rest on SNS topics,
`RemovalPolicy.DESTROY` as the default, and no Lambda X-Ray tracing.
