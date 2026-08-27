# Platform Migration Map

Maps concrete artifacts in legacy integration platforms to the EIP, the construct in this library,
and the AWS services underneath. Use it to speak the team's vocabulary in Stage 2 of discovery.

Construct names here are authoritative only insofar as they match
`eip-cdk-patterns/references/construct-catalog.md` and `lib/index.ts`. If a name in this file does
not appear there, the catalog wins — read it and correct this file.

**A mapping is a starting point, not a decision.** Confirm the five deciding facts from
`discovery-questions.md` before committing to a construct. The same BizTalk orchestration maps to
`ProcessManager` or `SagaOrchestration` depending entirely on whether failed steps must be undone.

---

## Microsoft BizTalk Server

The most common migration source, and the one where the mapping is cleanest — BizTalk was built on
EIP vocabulary.

| BizTalk artifact | EIP | Construct | AWS services |
|---|---|---|---|
| Receive port / receive location, file adapter | Channel Adapter | `FileTransfer` | Transfer Family, S3, EventBridge |
| Receive location, HTTP/SOAP adapter | Channel Adapter | `ContentEnricher` (has an optional REST API) or API Gateway to `RequestReply` | API Gateway, Lambda, SQS |
| Receive location, MQSeries / WebSphere MQ / JMS adapter | Messaging Bridge | `PublishSubscribeMq`, `RequestReplyMq` | Amazon MQ (ActiveMQ) |
| MessageBox publish-subscribe engine | Publish-Subscribe | `PublishSubscribeSns` | SNS, SQS |
| Send port with a filter expression | Message Filter | `MessageFilter` | EventBridge rule |
| Send port group / multiple filtered subscribers | Recipient List, Content-Based Router | `ContentBasedRouter` | EventBridge bus and rules |
| Map (.btm), XSLT | Message Translator | `MessageTranslator` | Lambda |
| Schema (.xsd) with flat-file disassembler | Message Translator plus Splitter | `MessageTranslator`, `Splitter` | Lambda, SNS, SQS |
| Receive pipeline, disassemble stage (debatching) | Splitter | `Splitter` | Lambda, SNS, SQS |
| Sequential convoy / correlated receive loop | Aggregator | `Aggregator` | DynamoDB, Lambda |
| Ordered delivery on a send port | Resequencer | `Resequencer`, or `PublishSubscribeSns` with `fifo` | SQS FIFO, DynamoDB |
| Orchestration (XLANG), sequential, no rollback | Process Manager | `ProcessManager` | Step Functions, Lambda |
| Orchestration with a compensation block in scope | Saga | `SagaOrchestration` | Step Functions, Lambda |
| Orchestration, steps owned by different teams | Saga (choreography) | `SagaChoreography` | SNS, SQS, Lambda |
| Dynamic send port, itinerary (ESB Toolkit) | Routing Slip | `RoutingSlip` | Step Functions Map state, Lambda |
| BAM activity tracking | Wire Tap | `WireTap` | EventBridge, Kinesis Data Firehose, S3 |
| Tracked message bodies, message archive | Message Store | `MessageReplayArchive` | SNS, S3, DynamoDB, API Gateway |
| Suspended message queue, resume/terminate | Dead Letter Channel | built-in DLQs on every construct | SQS DLQ |
| Host instance throttling, message-count throttle | Throttler | `Throttling` | SQS, Lambda reserved concurrency, API Gateway usage plan |
| Retry count and retry interval on a send port | Retry | `RetryWithBackoff` | SQS visibility timeout |
| EDI party, agreement, AS2 | *no construct* | — | AWS B2B Data Interchange, Transfer Family AS2 |
| Business Rules Engine (BRE) | *no construct* | — | Lambda, or a rules engine you supply |
| Windows service host, in-process adapters | compute | Lambda for < 15 min, ECS Fargate beyond | Lambda, ECS Fargate |

**Traps.** BizTalk's MessageBox gave durable store-and-forward and automatic retry to everything by
default; teams often do not know which interfaces depended on it. Ask question 6 of Stage 2 for every
interface. Declarative BizTalk maps have no equivalent runtime here — every `.btm` becomes handler
code, and that is usually the largest single line item in the migration.

---

## MuleSoft (Mule 4 / Anypoint Platform)

| Mule artifact | EIP | Construct | AWS services |
|---|---|---|---|
| Flow with an HTTP Listener source | Channel Adapter | `RequestReply`, `ContentEnricher` | API Gateway, Lambda, SQS |
| Choice router | Content-Based Router | `ContentBasedRouter` | EventBridge |
| Filter / validation in a flow | Message Filter | `MessageFilter` | EventBridge rule |
| Scatter-Gather router | Scatter-Gather | `ScatterGather` | SNS, DynamoDB, Lambda |
| Collection splitter, `foreach` | Splitter | `Splitter` | Lambda, SNS, SQS |
| Aggregator (`aggregators` module) | Aggregator | `Aggregator` | DynamoDB, Lambda |
| DataWeave `transform` | Message Translator | `MessageTranslator` | Lambda |
| VM queue, persistent VM queue | Message Channel | the queues inside each construct | SQS |
| Anypoint MQ queue or exchange | Publish-Subscribe | `PublishSubscribeSns` | SNS, SQS |
| JMS or AMQP connector to a broker that stays | Messaging Bridge | `PublishSubscribeMq`, `RequestReplyMq` | Amazon MQ |
| `until-successful` scope | Retry | `RetryWithBackoff` | SQS visibility timeout |
| Circuit breaker (Mule 4) | Circuit Breaker | `CircuitBreaker` | DynamoDB, Lambda |
| Idempotent Message Validator | Idempotent Receiver | `IdempotentReceiver` | DynamoDB |
| Object Store v2 | state store | the DynamoDB tables inside the relevant constructs | DynamoDB |
| API policies, SLA tiers, rate limiting | Throttler | `Throttling` | API Gateway usage plan, reserved concurrency |
| Batch job with steps | Process Manager | `ProcessManager` | Step Functions, ECS Fargate or Batch |
| SFTP or FTP connector | Managed File Transfer | `FileTransfer` | Transfer Family, S3 |
| Experience/process/system API layering (API-led) | API Composition | `ApiCompositionAppSync`, `ApiCompositionApollo` | AppSync, or ALB and Fargate |
| Saga (no native Mule equivalent) | Saga | `SagaOrchestration` | Step Functions |
| Anypoint Monitoring, custom dashboards | *no construct* | — | CloudWatch, X-Ray. **You must build this** |
| CloudHub worker sizing | compute | Lambda or Fargate by duration and payload | Lambda, ECS Fargate |

**Traps.** DataWeave is a genuine productivity loss — nothing in AWS replaces it declaratively, and
every transform becomes code. Mule's Object Store is often used as an ad-hoc cache with no documented
TTL semantics; establish what the actual expiry requirement is before mapping it to a DynamoDB TTL.
API-led layering frequently produces chatty synchronous chains, which is an anti-pattern worth
flagging rather than reproducing.

---

## Boomi (AtomSphere)

| Boomi shape or concept | EIP | Construct | AWS services |
|---|---|---|---|
| Start shape with a connector | Channel Adapter | `FileTransfer`, `RequestReply` | Transfer Family, API Gateway, SQS |
| Decision shape | Content-Based Router | `ContentBasedRouter` | EventBridge |
| Route shape | Content-Based Router | `ContentBasedRouter` | EventBridge |
| Map shape | Message Translator | `MessageTranslator` | Lambda |
| Data Process shape, split documents | Splitter | `Splitter` | Lambda, SNS, SQS |
| Data Process shape, combine documents | Aggregator | `Aggregator` | DynamoDB, Lambda |
| Cross-Reference table lookup | Content Enricher | `ContentEnricher` | Lambda, DynamoDB |
| Try/Catch shape | Dead Letter Channel | built-in DLQs, Step Functions catch | SQS DLQ, Step Functions |
| Process Route, callable subprocess | Routing Slip | `RoutingSlip` | Step Functions Map state |
| Multi-step process with rollback needs | Saga | `SagaOrchestration` | Step Functions |
| Boomi Queues, publish/subscribe | Publish-Subscribe | `PublishSubscribeSns` | SNS, SQS |
| Document tracking | Wire Tap | `WireTap` | EventBridge, Firehose, S3 |
| Atom, Molecule, Atom Cloud runtime | compute | Lambda or ECS Fargate | Lambda, ECS Fargate |
| Environment extensions | configuration | *no construct* | Parameter Store, Secrets Manager |
| EDI trading partner, AS2 | *no construct* | — | AWS B2B Data Interchange, Transfer Family AS2 |

**Traps.** Boomi teams are frequently configure-not-code, and this library is code. Raise the skills
finding in Stage 1, not at the end. Boomi's document-level retry and per-document error handling is
implicit; make it explicit per interface.

---

## TIBCO

| TIBCO artifact | EIP | Construct | AWS services |
|---|---|---|---|
| EMS topic | Publish-Subscribe | `PublishSubscribeSns`, or `PublishSubscribeMq` to keep JMS clients | SNS, SQS, Amazon MQ |
| EMS queue, point-to-point | Message Channel | `RequestReply` | SQS |
| Rendezvous multicast | Publish-Subscribe | `PublishSubscribeSns` | SNS |
| BusinessWorks process | Process Manager | `ProcessManager` | Step Functions, Lambda |
| BusinessWorks Mapper activity | Message Translator | `MessageTranslator` | Lambda |
| ActiveMatrix BPM long-running process | Saga | `SagaOrchestration` | Step Functions |
| Adapter for SAP, mainframe, AS/400 | *no construct* | — | custom ECS Fargate adapter |
| Hawk monitoring | *no construct* | — | CloudWatch, X-Ray |

---

## Informatica

Be careful here. Most Informatica estates are **data integration**, not application integration, and
this library is the wrong tool for the bulk of it.

| Informatica artifact | Maps to | AWS services |
|---|---|---|
| PowerCenter mapping and workflow | **not this library** — bulk ETL | AWS Glue, EMR, Redshift |
| Cloud Data Integration task | **not this library** — bulk ETL | AWS Glue, DMS |
| Cloud Application Integration process | `ProcessManager` | Step Functions, Lambda |
| Taskflow, sequential steps | `ProcessManager` | Step Functions |
| Process with compensation | `SagaOrchestration` | Step Functions |
| Real-time API-triggered process | `RequestReply`, `ContentEnricher` | API Gateway, Lambda, SQS |
| Hierarchical/flat-file parsing for app integration | `MessageTranslator`, `Splitter` | Lambda |

**Rule of thumb.** If it moves rows into a warehouse on a schedule, it is Glue, not this library. If
it moves a business document between applications and someone is waiting for the outcome, it is this
library. Split the portfolio on that line in Stage 1 and hand the ETL half to a data team.

---

## Workato

| Workato artifact | EIP | Construct | AWS services |
|---|---|---|---|
| Recipe trigger, webhook | Channel Adapter | `RequestReply`, `ContentBasedRouter` | API Gateway, EventBridge |
| Recipe trigger, polling | Polling Consumer | `Outbox` if you own the writer, otherwise a scheduled Lambda | EventBridge Scheduler, Lambda |
| Recipe steps, sequential actions | Process Manager | `ProcessManager` | Step Functions |
| Callable recipe | Routing Slip step | `RoutingSlip` | Step Functions Map |
| Conditional / IF action | Content-Based Router | `ContentBasedRouter` | EventBridge |
| Error monitor and retry | Retry, Dead Letter Channel | `RetryWithBackoff`, built-in DLQs | SQS |
| Lookup table | Content Enricher | `ContentEnricher` | Lambda, DynamoDB |
| Connector SDK | *no construct* | — | Lambda handler you write |

**Traps.** Workato recipes are usually built by business users against SaaS connectors. The connector
inventory is the migration risk, not the flow logic — every SaaS connector becomes an API client you
write and maintain. Count the connectors in Stage 1.

---

## Protocol and topology patterns, platform-independent

Use these when the team describes the shape rather than naming a product.

| What they describe | Construct | AWS services |
|---|---|---|
| "Legacy clients speak JMS and cannot be changed" | `PublishSubscribeMq`, `RequestReplyMq` | Amazon MQ |
| "A partner drops a file on our SFTP overnight" | `FileTransfer`, then `Splitter` | Transfer Family, S3, Lambda |
| "The file is too big for the queue" | `ClaimCheck` | S3, SQS, Lambda |
| "Caller waits for a response but the work is slow" | async with callback: `RequestReply` plus `ProcessManager` | SQS, Step Functions |
| "We expose SOAP and consumers want REST" | `MessageTranslator` behind API Gateway | API Gateway, Lambda |
| "We must never lose an event when the database write rolls back" | `Outbox` | DynamoDB Streams, EventBridge Pipes, SNS |
| "Same order sometimes gets processed twice" | `IdempotentReceiver` | DynamoDB |
| "One downstream keeps falling over and takes us with it" | `CircuitBreaker` plus `RetryWithBackoff` | DynamoDB, SQS, Lambda |
| "Audit wants proof of everything we sent" | `WireTap`, or `MessageReplayArchive` if replay is needed | EventBridge, Firehose, S3 |
| "We need to reprocess yesterday's messages" | `MessageReplayArchive` | SNS, S3, DynamoDB, API Gateway |
| "One request, five backends, combine the answers" | `ScatterGather` for async, `ApiCompositionAppSync` for a read API | SNS, DynamoDB, AppSync |
| "Steps differ per message type" | `RoutingSlip` | Step Functions Map |
| "Records must stay in order per customer" | `PublishSubscribeSns` with `fifo`, or `EventStreaming` partitioned by customer | SQS FIFO, Kinesis |
| "Continuous high-volume telemetry" | `EventStreaming` | Kinesis Data Streams, Lambda, DynamoDB |
| "Partner floods us with requests" | `Throttling` | API Gateway usage plan, reserved concurrency |
