# AWS Enterprise Integration Patterns — CDK Construct Library

Declarative AWS CDK constructs implementing the canonical [Enterprise Integration Patterns](https://www.enterpriseintegrationpatterns.com/) (Hohpe & Woolf). Deploy production-ready messaging architectures with a single construct declaration.

The library packages 29 canonical integration patterns as reusable L3 constructs — pub/sub, request-reply,
content-based routing, scatter-gather, splitter, aggregator, resequencer, saga (choreographed and
orchestrated), claim check, outbox, idempotent receiver, circuit breaker, throttling, managed file
transfer and more. Each construct wires the underlying AWS services (EventBridge, SNS, SQS, Step
Functions, Lambda, Kinesis, DynamoDB, AppSync, Amazon MQ, Transfer Family) with dead-letter queues,
retries, encryption and least-privilege IAM already in place, so you declare the pattern rather than
assemble the plumbing.

It is aimed at teams replacing legacy middleware — BizTalk, MuleSoft, Boomi, TIBCO, Informatica,
Workato — or standardising a sprawl of hand-rolled integrations onto one reviewed set of building
blocks. Patterns compose: a file-based interface is usually `FileTransfer` plus `MessageTranslator`
plus `Splitter`, not one bespoke stack.

Alongside the constructs, the repo ships an agent-led discovery pathway: two Agent Skills and two
custom agents that let a coding assistant run the engagement with you. `integration-advisor` asks the
discovery questions, maps each of your existing interfaces to a construct, and writes an assessment
file; `eip-architect` picks that assessment up and writes the CDK against the real props interfaces.
See [Use with an AI coding agent](#use-with-an-ai-coding-agent) — it works from a plain clone, with no
install or configuration step.

## Prerequisites

- An AWS account with the AWS CDK bootstrapped in your target Region
- Node.js 20+
- AWS CDK CLI v2
- AWS credentials configured
- TypeScript 5.x
- For Path 2 below, [Kiro](https://kiro.dev) or Claude Code

Running the test suite on a memory-constrained machine? Each Jest worker loads its own copy of
`aws-cdk-lib`, so use `npm test -- --runInBand` for a fully serial run.

## Getting Started

There are two ways to go from a requirement to a deployed pattern.

**Path 1 is hands-on:** you write the construct declaration and run the CDK commands yourself.
**Path 2 is agent-assisted:** the agents shipped in this repository select and configure the
construct for you, and you run the final deploy.

Both produce the same thing — a small `bin/app.ts` that instantiates one or more of the 29 library
constructs — so the security posture is identical whichever you choose. Start with Path 1 if you
already know which pattern you need. Start with Path 2 if you are coming from a legacy platform's
vocabulary and want help mapping it.

Both paths begin the same way:

```bash
git clone https://github.com/aws-samples/sample-enterprise-integration-patterns-cdk.git
cd sample-enterprise-integration-patterns-cdk
npm ci
npm run build
npm test
```

This repository is a construct library, not a deployable application. `bin/app.ts` ships as an
empty stub, and `npx cdk synth` on a fresh clone produces no stacks by design.

### Path 1: declare a pattern yourself

Open `bin/app.ts` and declare the construct you need. The [Implementation Guide](docs/implementation-guide.md)
has worked examples for request-reply, publish-subscribe, scatter-gather and saga, and
[`docs/patterns.md`](docs/patterns.md) has a usage example for every construct. Then synthesize
and deploy:

```bash
npx cdk synth
npx cdk deploy
```

`npm run build` type-checks your declaration against the construct's real `*Props` interface, and
`cdk synth` confirms it produces valid CloudFormation, so a wrong prop name fails before anything
reaches your account. `npm test` exercises the 29 library constructs themselves rather than your
declaration; it confirms the library is intact.

### Path 2: let the agents do the selection and configuration

Open the repository in Kiro or Claude Code. In Kiro, pick the agent from the bottom bar of the chat
input; in Claude Code, ask it to delegate, for example *"use the eip-architect agent to design the
order export interface."*

Describe the integration requirement in your own terms. The agent selects the right construct from
the library, writes the declaration into `bin/app.ts` with correctly configured props, and validates
it with `npm run build`, `npm test` and `cdk synth`. Deployment stays with you: the shipped
`eip-architect` agent is denied `cdk deploy` and `cdk destroy` by design, so nothing reaches an
account without a human running it. When the agent reports the declaration ready, you run the same
two commands as Path 1.

The repo ships two Agent Skills and two custom agents for this. Use them in order, or go straight to
the second if you already know what you are building:

- **`integration-advisor`** runs discovery. It asks the questions, maps each of your existing
  interfaces to a construct, and writes an assessment file. It touches no code.
- **`eip-architect`** picks that assessment up and writes the CDK declarations that instantiate the
  right library constructs with the correct configuration for each pattern, then verifies them.

**Want to see it run before trying it on your own estate?**
[`examples/path-2-with-agents/`](examples/path-2-with-agents/README.md) is a scripted, 25-minute
walkthrough: five BizTalk interfaces at a fictional retailer, ten prompts you type, and what each
agent does in response. It covers the handoff between the two agents, a contrast pair (two BizTalk
orchestrations that map to different constructs on one answer), a three-construct composition, and
the moment the architect refuses to deploy. Swap in your own interfaces at Prompt 3 to use it as a
template for a real engagement.

The [Use with an AI coding agent](#use-with-an-ai-coding-agent) section below covers the agents in
depth: which to start with, what each produces, and how to run them in each tool.

### Clean up

Remove anything you deployed with `npx cdk destroy`. The constructs default to
`RemovalPolicy.DESTROY`, so the queues, tables and buckets a pattern created are removed with the
stack.

### Using the constructs in your own CDK app

`bin/app.ts` is a convenient place to try a pattern. For your own platform you will not build inside
a clone of this repository; bring the constructs into your own CDK application instead. This is
sample code and is not published to the npm registry, so take one of two routes:

- **Vendor the source.** Copy `lib/` into your project and import from it directly. You own the
  code from that point and can adapt it freely; this is the intended way to consume a sample.
- **Install from the Git URL.** `npm install github:aws-samples/sample-enterprise-integration-patterns-cdk`
  pulls the repository as a dependency. Run `npm run build` inside it once so `dist/` exists, then
  import from the package root.

Either way, `aws-cdk-lib` and `constructs` are peer dependencies, so your app supplies them. The
agents work the same way in your repository as in this one.

## Use with an AI coding agent

This repo ships two [Agent Skills](https://agentskills.io) and two custom agents that teach a coding
assistant how to assess an integration estate and how to pick and configure these constructs. Clone
the repo and they work — no install step, no configuration.

| What | Name | Purpose |
|---|---|---|
| Skill | `integration-discovery` | Welcome, discovery questions, legacy platform mapping, assessment template |
| Skill | `eip-cdk-patterns` | Selection workflow, construct catalog, anti-pattern guardrails |
| Agent | `integration-advisor` | Runs discovery: maps your existing interfaces to constructs. Read-mostly |
| Agent | `eip-architect` | Implements: designs integrations, writes CDK, audits existing code |

### Which one do I start with?

**Start with `integration-advisor` if** you are new to the library, you are sizing up a migration off
BizTalk, MuleSoft, Boomi, TIBCO, Informatica or Workato, or you can describe your interface but not
yet in AWS terms. It asks about your current platform, maps each interface to a construct and the AWS
services underneath, and produces an assessment table you can circulate. It is deliberately
read-mostly — it will not modify constructs or tests.

**Start with `eip-architect` if** you already know the shape of what you are building and want the
CDK written. It reads the real `*Props` interface out of `lib/patterns/<file>.ts` before writing
config, so it works from the actual API surface rather than a copy that can drift, and it runs
`npm run build` and `npm test` before reporting a change complete.

The advisor hands off to the architect when discovery is done, so going through both in order is the
normal path rather than a detour.

### Running the two agents in order

The normal engagement is a two-step relay, with a file as the baton:

1. **Run `integration-advisor` first.** Describe your estate or one interface in your own platform's
   terms. The advisor asks its staged questions, maps each interface to a construct, and ends the
   session by writing the interface assessment to `assessments/<name>.md`. That file — not the chat
   transcript — is the handoff artifact.
2. **Then run `eip-architect`.** It checks `assessments/` and `docs/` at the start of a session and
   treats the assessment table as confirmed requirements, so it goes straight to configuration
   instead of re-asking discovery questions. It only reopens a row that carries an open question.

If you start with the architect and your requirement is still in legacy vocabulary with no
assessment on disk, it will send you back to step 1 rather than guess the mapping.

If your team cannot adopt CDK, the architect can still help: it will synthesize the configured
construct to a plain CloudFormation template via `npx cdk synth`, or walk you through the construct
source as a blueprint for a Terraform implementation — flagging in both cases that the export is a
fork that stops receiving library updates.

### What you end up with

Two artifacts, both on disk rather than in the chat transcript.

**From the advisor — `assessments/<name>.md`.** The filled-in
[interface assessment template](skills/integration-discovery/references/interface-assessment-template.md).
It is written to be reviewable by someone who was not in the session:

- a portfolio summary — platform, migration driver, interface counts by lane, systems that cannot
  move, AWS readiness, who will operate it
- portfolio groups, so an estate of 180 orchestrations collapses to a handful of representative
  interfaces rather than 180 investigations
- per interface, the five deciding facts (trigger, payload size, volume, latency, ordering) each
  with the consequence it drove, plus the three hidden requirements legacy middleware obscures
- the chosen construct, supporting constructs and AWS services underneath
- anti-patterns found, including ones being carried over from the current platform, with the failure
  mode named
- gaps where this library stops and what you must add yourself
- open questions, each naming the exact missing fact and what it blocks
- a recommended build sequence ordered by risk, and the cross-cutting work that gets missed in
  estimates — DLQ alarms, `RemovalPolicy.RETAIN` overrides, CMK strategy, handler code for every
  transformation, CDK enablement

**From the architect — CDK in the repo.** Construct declarations in `bin/app.ts`, any supporting code
in `lib/`, and tests in `test/`. It runs `npm run build` and `npm test` and only reports the change
complete when both pass.

`assessments/` does not exist in a fresh clone; the advisor creates it during the session, so it will
show up as an untracked directory afterwards. Commit it if you want the mapping reviewed and
circulated, or add it to `.gitignore` if the engagement detail should stay local.

### Getting from there to deployed

The architect deliberately cannot deploy — `npx cdk deploy` and `npx cdk destroy` are on its deny
list (`agents/eip-architect.targets.json`), along with `git push` and `rm -rf`. It designs and builds;
you keep the deploy decision. So the last step is yours:

```bash
npm run build
npm test
npx cdk synth
npx cdk deploy
```

Before a production cutover, work the cross-cutting table in the assessment rather than deploying
straight off the back of a green test run. The constructs default to `RemovalPolicy.DESTROY` and
create no CloudWatch alarms, so at minimum you need `RETAIN` on archives, DLQs and state tables, and
alarms on DLQ depth and Lambda errors. The advisor is instructed to raise these; the assessment file
is where they are recorded.

### What discovery looks like

The advisor asks a batch of questions rather than interrogating you one at a time, and it will not
name a construct until it knows five things about an interface: what triggers it, payload size,
volume, latency expectation, and whether ordering matters. It also asks the three questions legacy
middleware usually hides — what happens when the target is down, whether duplicate delivery causes
damage, and whether anything needs to be provable afterwards — because those requirements are
typically undocumented and become the defects in a migration.

A short exchange looks like this:

> **You**: We have about 180 BizTalk orchestrations. Licence renewal is next year.
>
> **Advisor**: *asks about the interface split, systems that can't move, who will operate it on AWS,
> compliance constraints, and current AWS readiness.*
>
> **You**: Mostly file-based, some SOAP. One orchestration has a compensation block.
>
> **Advisor**: Your compensation block is a Saga — `SagaOrchestration`, which is Step Functions with
> a catch per step routing to a compensation Lambda. Your flat-file disassembler is `MessageTranslator`
> plus `Splitter`. Before I commit to either, what's the largest file you receive?

It will also tell you when the library is the wrong tool. Bulk ETL belongs in Glue, EDI trading
partner management in AWS B2B Data Interchange, and CDC from a database you don't control in DMS.
Those gaps are written down in the skill rather than papered over.

### Setting up each tool, and how the agents are built

[`docs/agents.md`](docs/agents.md) covers the per-tool setup for Kiro, Claude Code and other
assistants, the repository layout of `skills/` and `agents/` and how `.kiro/` and `.claude/` are
generated from them, and the `sync:agents` / `check:agents` commands that keep them aligned.

## Architecture Overview

Each construct encapsulates an entire EIP pattern — the messaging infrastructure, IAM permissions, dead letter queues, event source mappings, and environment variables are all wired automatically. You declare *what* pattern you need; the construct handles *how*.

```
┌─────────────────────────────────────────────────────────┐
│                  Your CDK Stack                         │
│                                                         │
│  ┌─────────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ PublishSub   │  │ Request  │  │ Saga              │  │
│  │ scribeSns    │  │ Reply    │  │ Orchestration     │  │
│  │              │  │          │  │                   │  │
│  │ SNS→SQS→λ   │  │ SQS↔λ   │  │ SFN→λ→compensate │  │
│  │ +DLQs+IAM   │  │ +DLQs   │  │ +DLQs+state       │  │
│  └─────────────┘  └──────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

The full reference for all 29 constructs — a diagram of what each provisions, a usage example with
real props, its EIP classification and the AWS services underneath — is in
[`docs/patterns.md`](docs/patterns.md). Four end-to-end worked examples, from scenario through
handler code to message flow, are in [`docs/implementation-guide.md`](docs/implementation-guide.md).

---

## Accessing Underlying Resources

Every construct exposes its AWS resources as public properties for custom wiring:

```typescript
const pubsub = new PublishSubscribeSns(this, 'Events', { subscriberQueues: 2 });

// Grant another service publish access
pubsub.grantPublish(myOtherLambda);

// Access queues directly
pubsub.queues[0].grantConsumeMessages(myWorker);

// Reference the topic ARN
new CfnOutput(this, 'TopicArn', { value: pubsub.topic.topicArn });
```

## Common Configuration

All constructs accept `BasePatternProps`:

| Property | Type | Default | Description |
|---|---|---|---|
| `removalPolicy` | `RemovalPolicy` | `DESTROY` | CloudFormation removal policy for all resources |
| `deadLetterQueue.maxReceiveCount` | `number` | `3` | Max receives before sending to DLQ (honoured across all patterns) |
| `deadLetterQueue.retentionPeriodDays` | `number` | `14` | DLQ message retention (honoured across all patterns) |
| `logRetention` | `logs.RetentionDays` | `ONE_MONTH` | CloudWatch log retention applied to every Lambda |
| `lambdaTimeout` | `Duration` | `30s` | Default Lambda timeout for functions created by the pattern. Every SQS queue that feeds a Lambda gets a visibility timeout of 6× this value automatically (the AWS-recommended ratio), so raising it never trips Lambda's "function timeout must not exceed queue visibility timeout" check at deploy. `RetryWithBackoff` is the exception: its visibility timeout is the retry schedule (`initialVisibilityTimeoutSeconds`), so it fails synth with a clear message if you set `lambdaTimeout` higher than that. |

All SQS queues are `SQS_MANAGED` encrypted with `enforceSSL: true`. All S3 buckets are `BLOCK_ALL` public access, `S3_MANAGED` encrypted, with `enforceSSL: true`. SNS topics use `enforceSSL: true`. DynamoDB tables enable point-in-time recovery. AppSync defaults to `IAM` auth; API Gateway endpoints created by `ContentEnricher`, `MessageReplayArchive` and `Throttling` default to `IAM` auth unless an authorizer is supplied. `ApiCompositionApollo` keeps its load balancer internal unless `publicLoadBalancer: true` is set together with a `certificate`.

## Pattern Selection Guide

| Need | Pattern | Construct |
|---|---|---|
| Fan-out to multiple consumers | Publish-Subscribe | [`PublishSubscribeSns`](docs/patterns.md#publishsubscribesns) |
| JMS/AMQP compatibility | Publish-Subscribe | [`PublishSubscribeMq`](docs/patterns.md#publishsubscribemq) |
| Route by message content | Content-Based Router | [`ContentBasedRouter`](docs/patterns.md#contentbasedrouter) |
| Synchronous call + response | Request-Reply | [`RequestReply`](docs/patterns.md#requestreply) |
| Payloads > 256KB | Claim Check | [`ClaimCheck`](docs/patterns.md#claimcheck) or [`RequestReplyLargePayload`](docs/patterns.md#requestreplylargepayload) |
| Broadcast + collect responses | Scatter-Gather | [`ScatterGather`](docs/patterns.md#scattergather) |
| Collect messages into batches | Aggregator | [`Aggregator`](docs/patterns.md#aggregator) |
| Break composite messages apart | Splitter | [`Splitter`](docs/patterns.md#splitter) |
| Reorder out-of-sequence messages | Resequencer | [`Resequencer`](docs/patterns.md#resequencer) |
| Add data from external sources | Content Enricher | [`ContentEnricher`](docs/patterns.md#contentenricher) |
| Aggregate multiple APIs | API Composition | [`ApiCompositionAppSync`](docs/patterns.md#apicompositionappsync) |
| GraphQL federation | API Composition | [`ApiCompositionApollo`](docs/patterns.md#apicompositionapollo) |
| CQRS / audit trail | Event Streaming | [`EventStreaming`](docs/patterns.md#eventstreaming) |
| Multi-step transaction (decoupled) | Saga Choreography | [`SagaChoreography`](docs/patterns.md#sagachoreography) |
| Multi-step transaction (central) | Saga Orchestration | [`SagaOrchestration`](docs/patterns.md#sagaorchestration) |
| Message archival + replay | Message Replay | [`MessageReplayArchive`](docs/patterns.md#messagereplayarchive) |
| At-least-once dedup | Idempotent Receiver | [`IdempotentReceiver`](docs/patterns.md#idempotentreceiver) |
| Compliance / audit mirroring | Wire Tap | [`WireTap`](docs/patterns.md#wiretap) |
| Drop messages by predicate | Message Filter | [`MessageFilter`](docs/patterns.md#messagefilter) |
| Reliable publish-after-commit | Transactional Outbox | [`Outbox`](docs/patterns.md#outbox) |
| Format / schema mapping | Message Translator | [`MessageTranslator`](docs/patterns.md#messagetranslator) |
| Legacy SFTP/FTPS ingestion | File Transfer | [`FileTransfer`](docs/patterns.md#filetransfer) |
| Rate limit downstream / partner | Throttling | [`Throttling`](docs/patterns.md#throttling) |
| Protect downstream from failure | Circuit Breaker | [`CircuitBreaker`](docs/patterns.md#circuitbreaker) |
| Configurable retry policy | Retry with Backoff | [`RetryWithBackoff`](docs/patterns.md#retrywithbackoff) |
| Linear workflow (no compensation) | Process Manager | [`ProcessManager`](docs/patterns.md#processmanager) |
| Producer-defined dynamic workflow | Routing Slip | [`RoutingSlip`](docs/patterns.md#routingslip) |

## Contributing

Contributions are welcome — new patterns, bug fixes, doc improvements, and additional integration tests are all in scope.

### Project layout

```
.
├── bin/app.ts          # CDK entry point (library consumers wire their own stacks)
├── lib/
│   ├── index.ts        # Public barrel — every pattern is exported here
│   ├── types.ts        # BasePatternProps, DLQ/log/timeout defaults
│   └── patterns/       # One file per EIP construct
├── test/
│   ├── unit/           # Tier 1 — fast aws-cdk-lib/assertions tests
│   └── integ/          # Tier 2 — opt-in real-deploy integration tests
├── docs/
│   ├── patterns.md             # Reference for all 29 constructs — diagram, usage, classification
│   ├── implementation-guide.md # Four end-to-end worked examples
│   └── agents.md               # Per-tool agent setup, repository layout, sync commands
├── security/           # cdk-nag harness + summariser — `npm run security:nag:summary`
├── examples/           # Scripted walkthroughs — path-2-with-agents/ is the five-interface BizTalk demo
├── skills/             # Canonical Agent Skills — edit these, not .kiro/ or .claude/
├── agents/             # Canonical agent prompts + per-tool targets
├── scripts/            # sync-agent-config.mjs — regenerates .kiro/ and .claude/
├── .kiro/ .claude/     # Generated from skills/ and agents/ — do not edit
├── .github/workflows/  # CI: check:agents, build, unit tests
├── package.json
├── tsconfig.json
└── jest.config.ts
```

### Local development

```bash
git clone https://github.com/aws-samples/sample-enterprise-integration-patterns-cdk.git
cd sample-enterprise-integration-patterns-cdk
npm ci
npm run build      # tsc — must pass before opening a PR
npm test           # Tier 1 unit tests — required on every PR
```

**Requirements:** Node.js 20+, AWS CDK CLI v2, TypeScript 5.x.

### Tests

Two-tier suite — see `test/README.md` for the full rationale.

| Tier | Command | When |
|---|---|---|
| Unit (CFN assertions) | `npm test` | Every PR — must pass |
| Hosted integration | `RUN_HOSTED_INTEG=1 AWS_REGION=us-east-1 INTEG_TEST_ACCOUNT=<acct> npm run test:integ` | Nightly / pre-merge to main |
| Both | `RUN_HOSTED_INTEG=1 ... npm run test:all` | Release prep |

Coverage gates: **80% lines / 70% branches** for the unit tier.

### Adding a new pattern

1. **Construct** — `lib/patterns/<pattern>.ts`. Extend `BasePatternProps` from `lib/types.ts` so removal policy, DLQ config, log retention, and Lambda timeout are inherited.
2. **Export** — add the construct and its props interface to `lib/index.ts`.
3. **Unit test** — `test/unit/<pattern>.test.ts`. Use helpers in `test/unit/helpers.ts` (`assertAllQueuesSecure`, `assertAllBucketsSecure`, `assertAllTablesPointInTimeRecovery`) for security-default assertions. Cover:
   - Resource counts.
   - Key prop wiring (env vars, encryption, DLQ).
   - IAM least privilege.
   - Anti-pattern errors the construct rejects.
4. **Integ test (optional)** — `test/integ/<pattern>.integ.test.ts` only if runtime behaviour can't be proven by CFN assertions alone (e.g. correlation round-trips, state-machine completion).
5. **README** — add a section under the appropriate category with a Mermaid diagram, TypeScript usage example, EIP classification, and the AWS services involved. Match the existing pattern entries' style.
6. **Pattern selector** — add a row to the "Pattern Selection Guide" table at the end of this README.

### Coding conventions

- TypeScript strict mode (see `tsconfig.json`).
- One construct per file under `lib/patterns/`.
- All Lambdas and queues created by a pattern must respect `BasePatternProps` (no hardcoded retention / timeout).
- SQS queues default to `QueueEncryption.SQS_MANAGED`; opt out only with explicit justification in code review.
- Use inclusive language — no `master/slave`, `whitelist/blacklist` (prefer `primary/replica`, `allowlist/denylist`).

### Pull requests

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution process. In short:

- Branch from `main`.
- Title: imperative mood, scoped — e.g. `Add CircuitBreaker pattern`, `Fix DLQ wiring in Aggregator`.
- Description should reference the EIP being implemented and any AWS services added.
- Required checks: `npm run build`, `npm run check:agents`, `npm test`. Hosted integ tests are not required per-PR.
- Squash on merge for single-pattern additions; merge commit for multi-pattern refactors.

### Reporting issues

Open a GitHub issue with:
- Pattern name (if applicable).
- CDK version, Node version, OS.
- Minimal reproduction — usage snippet + the synth/deploy error.

For security issues, do not open a public issue — follow the
[AWS Vulnerability Reporting](https://aws.amazon.com/security/vulnerability-reporting/) process instead.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
