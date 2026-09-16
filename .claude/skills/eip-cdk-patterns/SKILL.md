---
name: eip-cdk-patterns
description: Select, configure and compose AWS CDK constructs for Enterprise Integration Patterns from this library. Use when building an integration on AWS, choosing between API / event-driven / streaming / file-based approaches, picking a messaging or orchestration pattern, wiring pub-sub, request-reply, saga, scatter-gather, claim-check, outbox, idempotency, circuit-breaker, throttling or managed file transfer, deciding between Lambda and ECS Fargate for an integration, or reviewing an integration design against AWS anti-patterns. Also use when asked which construct to use, how to configure one, or how to replace a legacy BizTalk / Workato / MuleSoft interface with AWS serverless.
license: Apache-2.0
metadata:
  version: 1.0.0
  repository: sample-enterprise-integration-patterns-cdk
  constructs: 29
---

# Enterprise Integration Patterns — AWS CDK Constructs

This library provides 29 CDK constructs that each implement a complete Enterprise Integration
Pattern on AWS. A construct provisions the channels, compute, state, IAM policies, dead-letter
queues and event source mappings for its pattern. The caller declares intent; the construct
wires the topology.

Constructs live in `lib/patterns/` and are re-exported from `lib/index.ts`.

## Non-negotiable rules

1. **Never invent a construct name or prop.** Every construct is listed in
   `references/construct-catalog.md`. Before writing config for one, read its source file at
   `lib/patterns/<file>.ts` and take the prop names from the `*Props` interface. Props are not
   documented in this skill on purpose — the source is the only accurate signature.
2. **Never hand-roll a pattern that already exists.** If the user is building fan-out, do not
   write raw `sns.Topic` + `sqs.Queue` + subscription code. Use `PublishSubscribeSns`. Check the
   catalog first.
3. **Never remove a dead-letter queue.** Every construct provisions DLQs deliberately. If a user
   asks to drop one, explain the failure mode they are accepting before doing it.
4. **Never route payloads over 256 KB through SQS.** Use `ClaimCheck` or
   `RequestReplyLargePayload`, which store the body in S3 and pass a reference.
5. **Never process files over 50 MB in Lambda.** Move to ECS Fargate or Batch. Lambda will fail
   on memory or the 15-minute ceiling.
6. **Never chain Lambda to Lambda for orchestration.** Use `ProcessManager`, `RoutingSlip`, or
   `SagaOrchestration`, all of which use Step Functions.
7. **Always verify after changing code.** Run `npm run build`, then `npm test`. Do not report
   a change as complete without both passing.

## Selection workflow

Work through these in order. Do not skip to a construct name.

### Step 1 — Classify the integration

Assign exactly one primary lane. If the user's description spans lanes, say so and pick the lane
that governs the *entry point*.

| Lane | Trigger | Processing |
|---|---|---|
| API-based | Caller expects a response | Synchronous |
| Event-driven | Reaction to a state change | Asynchronous |
| Streaming | Continuous high-throughput records | Continuous |
| File-based | Batch or scheduled file arrival | Batch |
| Database-source | Records polled or captured from a DB | Scheduled / CDC |

### Step 2 — Choose the compute

This decision comes before the pattern choice, because it eliminates whole branches.

| | AWS Lambda | ECS Fargate |
|---|---|---|
| Duration | ≤ 15s optimal, 15 min hard ceiling | > 15s, no ceiling |
| Payload / file | < 50 MB | 50 MB – 5 GB+ |
| Invocation | Native triggers (S3, EventBridge, SQS, DynamoDB Streams) | Queue polling or Step Functions |
| Best for | Spiky traffic, fire-and-forget, light transform | Stateful routing, protocol bridging, heavy batch |

If a synchronous API path routinely exceeds 15 seconds, do not scale the Lambda — change the
pattern to async with a callback.

### Step 3 — Pick the construct

Use `references/selection-guide.md`. It maps each lane, plus a stated threshold, to a named
construct. Never guess when the guide covers the case.

### Step 4 — Read the source, then configure

Open `lib/patterns/<file>.ts`, read the `*Props` interface and the public readonly members, then
write the config. Reference the public members when wiring the construct to surrounding
resources rather than reaching for the underlying CloudFormation.

### Step 5 — Check the design against the guardrails

`references/selection-guide.md` ends with an anti-pattern list. Walk the proposed design against
it and report any violation, including violations in code the user already wrote.

### Step 6 — Verify

```bash
npm run build      # tsc
npm test           # jest unit tests
npx cdk synth      # confirm the stack synthesizes
```

## Composing constructs

Constructs are designed to nest. Common combinations:

- **Reliable consumer**: `IdempotentReceiver` in front of business logic, `RetryWithBackoff` for
  transient failures, `CircuitBreaker` for a flaky downstream.
- **Audited event bus**: `ContentBasedRouter` for routing, plus `WireTap` on the same bus for a
  compliance archive, plus `MessageReplayArchive` when replay is a requirement.
- **Reliable publish**: `Outbox` so the event and the business write commit atomically, then
  `PublishSubscribeSns` for fan-out.
- **Large-file intake**: `FileTransfer` for the SFTP landing zone, `ClaimCheck` to keep the body
  out of the queue, `Splitter` to fan out records.

When composing, pass the shared resource explicitly. `WireTap` and `MessageFilter` attach to an
event bus you supply — they do not create one.

## What every construct gives you

Do not re-implement these; they are already applied:

- Dead-letter queue with configurable redrive on each channel
- SQS `SQS_MANAGED` encryption and `enforceSSL`
- S3 `BLOCK_ALL` public access, `S3_MANAGED` encryption, `enforceSSL`
- DynamoDB point-in-time recovery, TTL-based state expiry
- CloudWatch Logs retention and a default Lambda timeout
- Least-privilege IAM grants between the resources the construct creates

Shared props (`removalPolicy`, `runtime`, `lambdaTimeout`, `logRetention`, DLQ tuning) come from
`BasePatternProps` in `lib/types.ts`. Read that file before overriding a default.

## If the customer does not want CDK

Do not hand-write CloudFormation or Terraform that re-implements a construct. For CloudFormation,
instantiate the construct in a minimal CDK app and hand over the output of `npx cdk synth` — the
template carries every guardrail (DLQs, encryption, least-privilege IAM) the construct wires in.
For Terraform there is no automated path: use the construct source in `lib/patterns/<file>.ts` as
the reference blueprint for what to provision, and say so. Either way, tell the customer the export
is a fork — it stops receiving library updates the moment they take it.

## Output expectations

When asked to design or implement an integration, produce:

1. The lane classification and why.
2. The compute choice (Lambda or Fargate) and the threshold that drove it.
3. The named construct(s), and a config sketch using props read from the source file.
4. The cross-cutting concerns you added beyond the defaults, if any.
5. Any anti-pattern violations found in the existing design.

## Reference files

- `references/construct-catalog.md` — all 29 constructs, their source files, and the AWS
  resources each provisions. Read this to choose a construct.
- `references/selection-guide.md` — lane-by-lane selection with thresholds, plus the
  anti-pattern guardrails. Read this in step 3 and step 5.
