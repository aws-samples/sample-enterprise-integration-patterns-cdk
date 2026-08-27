# Discovery Questions

Ask each stage's questions in **one message**, numbered, and let the team answer in one pass. The
"decides" column is for you, not for them — do not paste it into the conversation. It tells you why
the question is worth their time, so you can drop a question you can already answer.

If they answer only half, work with that and ask the remainder once. Do not stall the session
waiting for completeness.

---

## Stage 1 — Current estate

Ask all of these. They take one message to answer and they shape everything downstream.

| # | Question | Decides |
|---|---|---|
| 1 | What integration platform are you on today, and which version? | Which section of `platform-migration-map.md` to work from |
| 2 | What is forcing the change — licence cost, end of support, a cloud mandate, skills, performance? | Sequencing and how much re-architecture they will tolerate. A licence cliff means lift-and-shift pressure; a cloud mandate allows redesign |
| 3 | Roughly how many interfaces, and how do they split across API/synchronous, event or message-driven, file/batch, and database-sourced? | Portfolio grouping, and which lanes matter |
| 4 | Which systems at either end cannot move or cannot be changed? | Whether Amazon MQ bridging (`PublishSubscribeMq`, `RequestReplyMq`) is needed, and where protocol adapters are required |
| 5 | Who runs the platform today, and will the same people run it on AWS? | Whether the "no visual designer" finding is a blocker. Configure-not-code teams need this raised in Stage 1 |
| 6 | Any data residency, compliance or network constraints — PCI, APRA CPS 234, sovereignty, private-only connectivity? | Region choice, whether public Transfer Family endpoints are acceptable, whether the missing CMK support is a blocker |
| 7 | Do you have AWS accounts, a CDK pipeline and a landing zone already, or is this greenfield? | Whether the first interface is a platform exercise or purely an integration exercise |

### Follow up only if the answers warrant it

- If they name a compliance regime requiring customer-managed keys: flag now that no construct
  currently accepts a KMS CMK, and that SNS topics are not encrypted at rest. This is a real gap and
  they need it before they commit, not after.
- If they mention an on-premises broker that stays: confirm whether clients can be repointed, or
  whether the broker itself must remain the integration point.

---

## Stage 2 — Per interface, the five deciding facts

Do not recommend a construct without these five. Ask them per interface, as a block.

| # | Question | Decides |
|---|---|---|
| 1 | What starts it — a caller waiting for a response, a state change, a file arriving, a schedule, or a database change? | The lane. Everything else follows from this |
| 2 | How big is a message or file, typically and at worst? | 256 KB is the SQS ceiling → `ClaimCheck` or `RequestReplyLargePayload`. 50 MB is the practical Lambda ceiling → Fargate |
| 3 | What volume — per day, and what does the peak look like? | Whether reserved concurrency and `Throttling` are needed, and whether streaming is justified |
| 4 | Does the caller wait for a result, and if so what is the acceptable wait? | Sync vs async. Past 10s, API Gateway is at risk; past 15 min, Lambda is out |
| 5 | Does order matter, and across what scope — globally, or per customer/account/entity? | FIFO, Kinesis partitioning, or `Resequencer`. "Per entity" is usually satisfiable; "globally" is expensive |

### Then the three that legacy middleware usually hid

Ask these explicitly. Teams rarely volunteer them because their current platform handled them
invisibly, which means the requirement was never written down.

| # | Question | Decides |
|---|---|---|
| 6 | What happens today when the target system is down or rejects a message? Who finds out, and how is it replayed? | `RetryWithBackoff`, `CircuitBreaker`, DLQ redrive policy, and whether `MessageReplayArchive` is required |
| 7 | Can the same message arrive twice, and does that cause damage — a duplicate payment, a duplicate order? | `IdempotentReceiver`. At-least-once delivery is the AWS default and this is the most common migration defect |
| 8 | Does anything need to be provable after the fact — an audit trail of what was sent and when? | `WireTap` for a bus archive, `MessageReplayArchive` when replay is also needed |

---

## Stage 3 — Transformation and orchestration shape

Only for interfaces that do more than move bytes.

| # | Question | Decides |
|---|---|---|
| 1 | What formats are involved on each side — XML, JSON, flat file, EDI, a partner-specific schema? | `MessageTranslator`, and whether they hit the EDI gap |
| 2 | Is the mapping declarative today (a BizTalk map, a DataWeave script, a Boomi map shape) or code? | Migration effort. Declarative maps must be rewritten as handler code — there is no map runtime here |
| 3 | Does one inbound message produce many outbound, or many inbound produce one? | `Splitter`, `Aggregator` |
| 4 | Does it call several systems and combine the answers? | `ScatterGather` if parallel and correlated, `ContentEnricher` if a single lookup, `ApiCompositionAppSync` if it is a read-side API |
| 5 | Is there a multi-step process, and if a later step fails must earlier steps be undone? | Compensation required → `SagaOrchestration` or `SagaChoreography`. Not required → `ProcessManager`. Steps vary per message → `RoutingSlip` |
| 6 | Do the steps belong to one team or several? | Central control → `SagaOrchestration`. Independently owned → `SagaChoreography` |
| 7 | Is a human ever in the loop — an approval, a manual fix? | The human-approval gap. Step Functions task token, no construct |

---

## Stage 4 — Operating model

Skip if the session is scoped to one interface. Essential for a platform migration.

| # | Question | Decides |
|---|---|---|
| 1 | How do you monitor and alert today, and where do alerts go? | The library ships **no CloudWatch alarms**. They must add DLQ-depth and Lambda-error alarms themselves. Say this |
| 2 | What does your deployment path look like — who can deploy to production, and how? | CDK pipeline shape, and whether `RemovalPolicy.DESTROY` as the library default is dangerous for them |
| 3 | How do you test an interface today, and do you have a way to test against partner systems? | Whether they need the hosted integ-test harness pattern in `test/integ/` |
| 4 | Where is per-environment configuration held today? | Parameter Store vs Secrets Manager vs CDK context |
| 5 | How many people will write CDK, and what is their TypeScript exposure? | Enablement need. This is usually the real project risk, not the architecture |

### Things to volunteer without being asked

Raise these in Stage 4 whether or not they come up. They are known gaps in the library and finding
out late is expensive:

- No CloudWatch alarms are created by any construct. DLQ depth and Lambda errors need alarms added.
- `RemovalPolicy.DESTROY` is the default in every construct. For anything holding an archive or a
  DLQ backlog, override it to `RETAIN`.
- No construct accepts a customer-managed KMS key, and SNS topics have no encryption at rest.
- No Lambda sets active X-Ray tracing, so traces break at each Lambda boundary.
- There is no cdk-nag or policy-as-code check in the repo. If they have a control framework, they
  will need to add one.
