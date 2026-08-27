# Construct Catalog

All 29 constructs, exported from `lib/index.ts`. The **Source** column is the file to read for the
exact `*Props` interface and the public readonly members — this catalog deliberately omits prop
names so it cannot drift from the code.

The **Provisions** column lists only what the construct creates itself. Resources you pass in
(VPCs, security groups, secrets, event buses, existing topics) are noted as *consumes*.

## Messaging

| Construct | Source | Provisions | Purpose |
|---|---|---|---|
| `PublishSubscribeSns` | `publish-subscribe-sns.ts` | SNS topic (optional FIFO), one SQS queue + DLQ per subscriber, subscriber Lambdas | One-way fan-out to N queues and Lambdas. Throws if FIFO is combined with Lambda subscribers. |
| `PublishSubscribeMq` | `publish-subscribe-mq.ts` | Amazon MQ broker (ActiveMQ 5.18.4, active/standby multi-AZ), response queue + DLQ, subscriber Lambdas, MQ event source mappings. *Consumes VPC, security group, Secrets Manager secret.* | Pub-sub over ActiveMQ with a shared correlated response queue. Use only to bridge legacy JMS/AMQP clients. |
| `ContentBasedRouter` | `content-based-router.ts` | EventBridge event bus, one rule per route, per-route SQS queue / SNS topic / Lambda, shared DLQ | Inspects content and routes to the matching channel via pattern-matched rules. |

## Request–Reply

| Construct | Source | Provisions | Purpose |
|---|---|---|---|
| `RequestReply` | `request-reply.ts` | Request + reply queues, both DLQs, consumer Lambda | Async request-reply over SQS with correlation IDs. Reply queue URL is injected into the consumer. |
| `RequestReplyMq` | `request-reply-mq.ts` | Amazon MQ broker, DLQ. *Consumes VPC, security group, secret.* | Request-reply over ActiveMQ. Intentionally binds no consumer — topologies vary per domain. |
| `RequestReplyLargePayload` | `request-reply-large-payload.ts` | S3 payload bucket with lifecycle expiry, request + reply queues, both DLQs, consumer Lambda | Request-reply with an S3 claim check for payloads past the 256 KB SQS limit. |

## Routing & Transformation

| Construct | Source | Provisions | Purpose |
|---|---|---|---|
| `ScatterGather` | `scatter-gather.ts` | SNS broadcast topic, DynamoDB **TableV2** correlation table (on-demand, TTL, stream), gather queue + DLQ, recipient subscription DLQ, aggregator Lambda, N recipient Lambdas | Broadcasts one request to N recipients and correlates the responses; the table stream triggers the aggregator. |
| `Aggregator` | `aggregator.ts` | Ingest queue + DLQ, DynamoDB state table (TTL, `NEW_AND_OLD_IMAGES` stream), collector + processor Lambdas | Collects fine-grained messages into batches keyed by `batchId`/`messageId`. Stream and TTL drive completion. |
| `Splitter` | `splitter.ts` | Input queue + DLQ, SNS output topic, N output queues each with a DLQ, splitter Lambda | Breaks a composite message into fragments and fans them out. |
| `Resequencer` | `resequencer.ts` | Input + output queues, DLQ, DynamoDB state table (`batchId` + numeric `sequenceId`, TTL, stream), collector + dispatcher Lambdas | Restores order for out-of-sequence messages. |
| `ContentEnricher` | `content-enricher.ts` | Input + output queues, DLQ, enricher Lambda, optional API Gateway REST API (`POST /enrich`, IAM auth) | Adds data from an external lookup before forwarding. |

## API Composition

| Construct | Source | Provisions | Purpose |
|---|---|---|---|
| `ApiCompositionAppSync` | `api-composition-appsync.ts` | AppSync GraphQL API (IAM auth default, X-Ray), Lambda and DynamoDB data sources and resolvers, pipeline resolvers | Serverless GraphQL composition — the EIP sync aggregator. |
| `ApiCompositionApollo` | `api-composition-apollo.ts` | ALB-fronted Fargate service via `ApplicationLoadBalancedFargateService`, health check `/.well-known/apollo/server-health`. *Consumes VPC, optional ACM certificate.* | Apollo Federation gateway for an always-on federated graph over many subgraphs. |

## Event & Streaming

| Construct | Source | Provisions | Purpose |
|---|---|---|---|
| `EventStreaming` | `event-streaming.ts` | Kinesis Data Stream (managed encryption), DynamoDB audit table, consumer Lambda | The only construct creating a real Kinesis Data Stream. For CQRS and audit logging. |
| `ClaimCheck` | `claim-check.ts` | S3 claim bucket with lifecycle expiry, input + output queues, DLQ, check-in + check-out Lambdas | Stores large payloads in S3 and passes claim tokens through SQS. |
| `MessageReplayArchive` | `message-replay-archive.ts` | SNS topic, versioned S3 archive bucket, DynamoDB metadata table with `by-date` GSI, archive queue + DLQs, N subscriber queues, archiver + replayer Lambdas, replay REST API | Archives every published message and exposes an authenticated replay API. |

## Saga / Long-Running Transactions

| Construct | Source | Provisions | Purpose |
|---|---|---|---|
| `SagaChoreography` | `saga-choreography.ts` | Per step: success + failure SNS topics, step queue + DLQ, compensation queue + DLQ, step Lambda, compensation Lambda | Event-driven saga. Success topics chain forward; failure topics drive backward compensation. Loosely coupled across teams. |
| `SagaOrchestration` | `saga-orchestration.ts` | State queue + DLQ, step Lambdas, optional per-step compensation Lambdas, orchestrator Lambda, Step Functions state machine with `addCatch` → compensation | Centrally orchestrated saga with try/catch compensation. Choose when you need central visibility. |

## Reliability, Resilience & Governance

| Construct | Source | Provisions | Purpose |
|---|---|---|---|
| `IdempotentReceiver` | `idempotent-receiver.ts` | Input queue + DLQ, DynamoDB dedup table (TTL), handler Lambda | Dedup table surfaced via env so the handler can reject duplicates. |
| `CircuitBreaker` | `circuit-breaker.ts` | Input queue + DLQ, DynamoDB breaker state table (TTL), handler Lambda | Tracks failures, writes an OPEN state with a cooldown TTL, short-circuits subsequent calls. |
| `RetryWithBackoff` | `retry-with-backoff.ts` | Input queue with visibility timeout, DLQ, worker Lambda | The SQS visibility timeout *is* the backoff window. Worker throws on transient failure. |
| `Throttling` | `throttling.ts` | Input queue + DLQ, worker Lambda with reserved concurrency and event-source `maxConcurrency`, optional API Gateway + API key + usage plan | Two independent rate-control layers: concurrency and an API usage plan. |
| `WireTap` | `wire-tap.ts` | Versioned S3 audit bucket with lifecycle, Firehose role, **Kinesis Data Firehose** delivery stream (GZIP, date-partitioned), EventBridge rule. *Consumes the event bus.* | Mirrors bus traffic to an S3 archive without disrupting consumers. Does not create a bus. |
| `MessageFilter` | `message-filter.ts` | EventBridge rule on the supplied bus, DLQ, optional output queue / SNS topic / Lambda. *Consumes the event bus.* | Declarative predicate filtering. No Lambda hop unless you target one. Does not create a bus. |
| `Outbox` | `outbox.ts` | DynamoDB outbox table (`NEW_IMAGE` stream, TTL), SNS topic unless one is supplied, pipe DLQ, pipe IAM role, **EventBridge Pipes** pipe filtered to `INSERT` | Transactional outbox. Business state and outbox row commit in one transaction; Pipes relays to SNS. |
| `MessageTranslator` | `message-translator.ts` | Input + output queues, DLQ, translator Lambda. Glue Schema Registry is referenced by env var only — no Glue resource is created. | Converts between formats: XML↔JSON, EDI segment↔canonical event, partner↔internal schema. |
| `FileTransfer` | `file-transfer.ts` | Versioned S3 landing bucket with EventBridge enabled, Transfer Family server (SFTP default, service-managed, public endpoint), transfer user IAM role, arrival rule, optional ingestion Lambda | Managed file transfer replacing legacy SFTP B2B drops. |
| `ProcessManager` | `process-manager.ts` | State queue + DLQ, per-step Lambdas, orchestrator Lambda, Step Functions state machine (sequential chain, X-Ray) | Linear central orchestration **without** compensation. Failure ends the workflow. |
| `RoutingSlip` | `routing-slip.ts` | Entry queue + DLQ, per-step Lambdas, dispatcher + orchestrator Lambdas, Step Functions state machine with a `Map` state | The message carries an `itinerary` array; the Map state iterates it and dispatches each step. |

## Constructs that consume rather than create

Pass these in explicitly — the construct will not create them:

| Construct | Must be supplied |
|---|---|
| `WireTap` | EventBridge event bus |
| `MessageFilter` | EventBridge event bus |
| `PublishSubscribeMq` | VPC, security group, Secrets Manager secret (JSON with `username` / `password`) |
| `RequestReplyMq` | VPC, security group, secret |
| `ApiCompositionApollo` | VPC, optional ACM certificate |
| `Outbox` | Optional destination topic (one is created if omitted) |

## Notable implementation details

- `ScatterGather` uses `dynamodb.TableV2`. Every other DynamoDB-backed construct uses `dynamodb.Table`.
- `WireTap` uses `firehose.CfnDeliveryStream` (L1). Only `EventStreaming` creates a `kinesis.Stream`.
- `Outbox` is the only construct using `pipes.CfnPipe`.
- `RequestReplyMq` deliberately provisions no consumer.
- `MessageTranslator` does not create a Glue Schema Registry despite referencing one by env var.
