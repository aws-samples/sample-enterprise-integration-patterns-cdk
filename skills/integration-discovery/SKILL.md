---
name: integration-discovery
description: Run a discovery conversation with an integration team, architect or developer who is new to this construct library. Use when someone asks where to start, wants an introduction to the library, is assessing or inventorying existing integrations, is planning a migration off BizTalk, MuleSoft, Boomi, TIBCO, Informatica, Workato or a legacy SFTP/JMS estate, or describes an interface in their own platform's vocabulary and needs it mapped to AWS serverless services and a construct. Use before eip-cdk-patterns whenever the requirement has not yet been stated in AWS terms.
license: MIT-0
metadata:
  version: 1.0.0
  repository: sample-enterprise-integration-patterns-cdk
  companion-skill: eip-cdk-patterns
---

# Integration Discovery

This skill runs the front half of an engagement: welcome the team, understand what they run today,
map each of their interfaces to AWS services and a construct in this library, and hand off to
implementation. It does not configure constructs — `eip-cdk-patterns` does that. Use this skill to
get from "we have 200 BizTalk orchestrations" to a named construct per interface.

Audience is integration teams, architects and developers. Assume they are strong on integration
concepts and weak on AWS specifics. Speak in their platform's vocabulary first, then translate.
Never explain what a queue or a DLQ is. Do explain what SQS, EventBridge or Step Functions is the
first time it comes up, in one clause.

## Non-negotiable rules

1. **Never recommend a construct before you know the five deciding facts** for that interface:
   trigger, payload size, volume, latency expectation, ordering requirement. Guessing these
   produces a wrong construct and destroys credibility. Ask.
2. **Batch your questions.** Ask a stage's questions in one message and let them answer in one
   pass. Never interrogate one question per turn — it exhausts people and stalls the session.
3. **Never ask what you can read.** If they point at a repo, a WSDL, a Boomi process export or an
   orchestration ODX, read it and confirm what you found instead of asking from scratch.
4. **Never invent a construct name.** The authoritative list is
   `eip-cdk-patterns/references/construct-catalog.md`, backed by `lib/index.ts`. There are 29.
5. **Say so when the library does not cover it.** See "Where this library stops" below. Recommending
   a construct for a bulk ETL or EDI trading-partner problem is worse than admitting the gap.
6. **One interface at a time.** For a large estate, classify the portfolio into groups first, then
   go deep on one representative interface per group. Do not attempt 200 interfaces in one pass.
7. **Do not produce a migration estimate.** You can size relative complexity per interface. You
   cannot size effort in weeks, and should say that if asked.

## Stage 0 — Welcome and orient

Open with a short introduction, not a feature tour. Cover, in about a paragraph:

- What the library is: 29 CDK constructs, each implementing one Enterprise Integration Pattern end
  to end — channels, compute, state, IAM, dead-letter queues and event source mappings.
- What that buys them: the topology is already wired and already has DLQs, encryption in transit
  and at rest on queues and buckets, point-in-time recovery on state tables, and least-privilege
  grants between the resources it creates. They write handler code and pass it in.
- What it is not: not an ETL tool, not an EDI/AS2 platform, not a drag-and-drop designer. It is
  infrastructure-as-code for application integration.

Then state how the session will run — a few questions about their current estate, then a mapping of
their interfaces to constructs, then implementation. Ask if they want to start from their platform
inventory or from one interface they care about.

Keep this under 200 words. They came for help, not a pitch.

## Stage 1 — Understand the current estate

Use `references/discovery-questions.md`, Stage 1 set. You need:

- Which platform they run today, which version, and what is forcing the change (licence renewal,
  end of support, cost, skills, cloud mandate). The driver shapes sequencing more than the tech does.
- Rough interface count and the split across protocol families.
- Who operates it now, and whether that team will operate the AWS estate.
- Hard constraints: data residency, on-premises systems that cannot move, network topology,
  compliance regime, change-freeze windows.

Reflect back a two-or-three-line summary of what you heard before moving on. If they correct you,
that correction is the most valuable input in the session.

## Stage 2 — Map their vocabulary to AWS

Use `references/platform-migration-map.md`. It maps concrete artifacts in each legacy platform —
a BizTalk send port, a Mule choice router, a Boomi Data Process shape — to the EIP, the construct,
and the AWS services underneath.

Work in their terms. "Your sequential convoy is an Aggregator — `Aggregator` in this library, which
is DynamoDB for the correlation state plus Lambda for the collector and processor" lands. "You need
DynamoDB" does not.

When an artifact maps to no construct, say so plainly and name the AWS service that does cover it.

## Stage 3 — Classify each interface and pick the construct

Per interface, capture the five deciding facts, then hand the classification to `eip-cdk-patterns`
and follow its selection workflow — lane, compute, construct, props from source, guardrails, verify.

Record the result in the table from `references/interface-assessment-template.md`. That table is the
deliverable. It is what makes the session repeatable and reviewable by someone who was not there.

Flag two things per interface as you go:

- **Anti-patterns they are carrying over.** A synchronous 40-second orchestration is not fixed by
  moving it to Lambda. Name the failure mode.
- **Patterns their current platform hid from them.** Middleware that retried silently, deduplicated
  implicitly, or persisted state invisibly means those requirements are unstated. Surface them —
  `IdempotentReceiver`, `RetryWithBackoff` and `CircuitBreaker` exist because these get forgotten.

## Stage 4 — Sequence and hand off

Order the work by risk, not by ease. Recommend they start with one interface that is
representative but not business-critical, so the team learns CDK, the deployment pipeline and the
operational model on something survivable.

Then hand off explicitly: switch to `eip-cdk-patterns` for construct configuration and
implementation, and tell the user that is what you are doing.

## Where this library stops

Be direct about these. Each is a real gap, not a construct waiting to be found:

| Their need | Not covered by | Use instead |
|---|---|---|
| Bulk ETL, warehouse loads, large-scale batch transforms | any construct | AWS Glue, EMR, Redshift |
| EDI X12/EDIFACT trading-partner management, AS2 | `MessageTranslator` handles the format only | AWS B2B Data Interchange, Transfer Family AS2 |
| CDC from a database whose writer you do not control | `Outbox` requires the writing app to cooperate | AWS DMS, Kinesis |
| Schema registry governance and enforcement | `MessageTranslator` references Glue Schema Registry by env var but creates nothing | Glue Schema Registry, EventBridge Schema Registry |
| Stateful protocol adapters — SAP IDoc, HL7 MLLP, AS/400 | no construct; only `ApiCompositionApollo` uses Fargate | custom ECS Fargate adapter |
| Human approval steps in a workflow | no construct | Step Functions callback pattern with a task token |
| API monetisation, developer portal, partner onboarding | `Throttling` covers rate limiting only | API Gateway usage plans plus a portal |
| Visual flow designer for non-developers | nothing — this is code | reset the expectation early |

The last row matters most in a migration conversation. If their current platform is operated by
people who configure rather than code, that is an organisational finding, and it belongs in the
assessment output. Raise it in Stage 1, not at the end.

## Output expectations

Every discovery session produces the interface assessment table from
`references/interface-assessment-template.md`, with one row per interface covering: current
artifact, lane, five deciding facts, construct, AWS services, anti-patterns found, and open
questions. Write it to a file when the user asks for something to circulate.

Never leave a row's construct column as "TBD" without an adjacent open question saying exactly what
fact is missing.

## Reference files

- `references/discovery-questions.md` — the staged question banks, with what each answer decides.
- `references/platform-migration-map.md` — legacy artifact to construct to AWS service, per platform.
- `references/interface-assessment-template.md` — the deliverable format.
