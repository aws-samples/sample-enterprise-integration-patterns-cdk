# Interface Assessment Template

The deliverable of a discovery session. One row per interface. It exists so the session is
reviewable by someone who was not in the room, and so the mapping survives the conversation.

Fill it as you go, not at the end. Write it to a file when the user wants something to circulate.

---

## Portfolio summary

Complete this first, from Stage 1 answers.

```
Organisation / team:
Current platform and version:
Migration driver:
Total interfaces:            (API: __  event: __  file: __  database: __)
Systems that cannot move:
Constraints:                 (residency, compliance, network, change windows)
AWS readiness:               (accounts, landing zone, CDK pipeline: yes / partial / greenfield)
Who will operate it:
Skills position:             (TypeScript / CDK exposure across the team)
```

### Portfolio groups

Group the estate before going deep. One representative interface per group.

| Group | Description | Count | Representative interface | Likely construct |
|---|---|---|---|---|
| | | | | |

---

## Per-interface assessment

One table per interface. Do not compress several interfaces into one row — the five deciding facts
differ and that is the whole point of capturing them.

```
Interface name:
Current artifact:            (e.g. BizTalk orchestration "OrderFulfilment", Boomi process "SAP-Invoice")
Business purpose:            (one line, in their words)
Source system:
Target system(s):
```

| Deciding fact | Answer | Consequence |
|---|---|---|
| Trigger | | lane = |
| Payload size (typical / max) | | queue and compute limits = |
| Volume (daily / peak) | | concurrency controls = |
| Latency expectation | | sync or async = |
| Ordering requirement | | FIFO, partitioning or resequencing = |

| Hidden requirement | Answer | Construct implication |
|---|---|---|
| Failure handling today | | |
| Duplicate delivery tolerance | | |
| Audit / replay requirement | | |

```
Lane:                        (API / event-driven / streaming / file-based / database-source)
Compute:                     (Lambda or Fargate) — threshold that decided it:
Primary construct:
Supporting constructs:
AWS services:
Transformation:              (formats in/out, declarative today? rewrite cost)
```

**Anti-patterns found**

List violations from the `eip-cdk-patterns` selection guide, including ones being carried over from
the current platform. State the failure mode, not just the rule.

| Anti-pattern | Where | Failure mode | Remediation |
|---|---|---|---|
| | | | |

**Gaps against this library**

Anything from the "Where this library stops" table in `SKILL.md`, plus the known library gaps
(no alarms, no CMK support, no SNS encryption at rest, `DESTROY` default, no Lambda tracing).

| Gap | Impact for this interface | What they must add |
|---|---|---|
| | | |

**Open questions**

Every unresolved construct choice needs a row here naming the exact missing fact.

| Question | Blocks | Owner |
|---|---|---|
| | | |

```
Relative complexity:         (low / medium / high) — basis:
Recommended sequence position:
```

---

## Recommended sequencing

Order by risk, not by ease. The first interface should be representative of a group but survivable
if it goes wrong, so the team learns CDK, the pipeline and the operating model on something safe.

| Order | Interface | Group | Why here | Prerequisites |
|---|---|---|---|---|
| 1 | | | learning vehicle | |
| 2 | | | | |

---

## Cross-cutting work

Work that is not attributable to a single interface and is usually missed in estimates.

| Item | Why it is needed | Notes |
|---|---|---|
| CloudWatch alarms on DLQ depth and Lambda errors | No construct creates alarms | Required before any production cutover |
| `RemovalPolicy.RETAIN` overrides | Library defaults to `DESTROY` | Mandatory for archives, DLQs, state tables |
| KMS CMK strategy | No construct accepts a CMK; SNS has no encryption at rest | Blocking if their compliance regime requires BYOK |
| Lambda X-Ray tracing | No construct sets `Tracing.ACTIVE` | Traces break at each Lambda boundary |
| Policy-as-code / cdk-nag | Not present in the repo | Needed if they have a control framework |
| CDK pipeline and multi-account bootstrap | Out of scope for the library | Often the real critical path |
| Handler code for every transformation | Declarative maps do not port | Usually the largest line item |
| Enablement on CDK and TypeScript | | The most common project risk |

---

## Sign-off

```
Assessed by:
Date:
Reviewed with:
Next step:                   (switch to eip-cdk-patterns and implement interface #1)
```
