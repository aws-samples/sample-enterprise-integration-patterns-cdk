# Selection Guide

Match the stated need and threshold to a construct. When a case is covered here, use the named
construct rather than composing raw resources.

## API-based

| Need | Pattern | Construct | Threshold |
|---|---|---|---|
| Short, stateless request | API Gateway → Lambda | `RequestReply`, `ContentEnricher` | < 15s |
| Long or CPU-heavy request | API Gateway → SQS → ECS | `ProcessManager` | > 15s processing |
| Enrich before responding | Lookup then forward | `ContentEnricher` | — |
| Rate-limit callers | Usage plan + reserved concurrency | `Throttling` | Per-client quotas needed |
| Protect a flaky downstream | Failure counting with cooldown | `CircuitBreaker` | Downstream error rate matters |
| Compose many backends | GraphQL | `ApiCompositionAppSync` | Serverless, resolver-based |
| Federate many subgraphs | Apollo Federation | `ApiCompositionApollo` | Always-on gateway |
| Internal-only surface | Private API Gateway | `RequestReply` behind a private API | High security requirement |

**Constraint:** if processing routinely exceeds 15 seconds, switch to an event-driven pattern with
a callback. Do not raise the Lambda timeout to paper over it.

## Event-driven

| Need | Pattern | Construct | Threshold |
|---|---|---|---|
| Fan-out to several consumers | SNS → multiple SQS | `PublishSubscribeSns` | > 3 subscribers, or per-consumer retry |
| Route by content | EventBridge rules | `ContentBasedRouter` | — |
| Drop non-matching events | Rule as predicate | `MessageFilter` | Filtering only, no transform |
| Publish atomically with a DB write | Outbox + Pipes | `Outbox` | Event loss on rollback is unacceptable |
| Deduplicate redeliveries | Dedup table | `IdempotentReceiver` | At-least-once delivery |
| Transient downstream failures | Visibility-timeout backoff | `RetryWithBackoff` | — |
| Distributed transaction, loose coupling | Event choreography | `SagaChoreography` | Steps owned by different teams |
| Distributed transaction, central control | Step Functions + compensation | `SagaOrchestration` | Need visibility and rollback |
| Sequential multi-step, no rollback | Step Functions chain | `ProcessManager` | Failure may simply end the flow |
| Steps vary per message | Step Functions Map over an itinerary | `RoutingSlip` | Route decided at runtime |
| Compliance archive of a bus | EventBridge → Firehose → S3 | `WireTap` | Audit requirement |
| Replay past messages | Archive + replay API | `MessageReplayArchive` | Recovery or audit requirement |
| Strict ordering | SQS FIFO | `PublishSubscribeSns` with `fifo` | Ordering required — no Lambda subscribers |
| Split a batch into records | Fan-out fragments | `Splitter` | — |
| Recombine records into a batch | Correlation table + TTL | `Aggregator` | — |
| Restore lost ordering | Sequence state table | `Resequencer` | Out-of-order arrival |
| Query many sources, combine | SNS broadcast + correlation | `ScatterGather` | Parallel fan-out then join |
| Convert formats | Transform Lambda | `MessageTranslator` | XML/JSON/EDI/partner schema |

**Constraint:** use Streaming instead if strict ordering across many producers is required.

**Thresholds for short vs long:** Lambda consumers are appropriate under 120s and 256 KB. Past
either, move to ECS.

## Streaming

| Need | Pattern | Construct | Threshold |
|---|---|---|---|
| Short-running record processing | Kinesis → Lambda | `EventStreaming` | < 120s, < 256 KB |
| Heavy record processing | Kinesis → ECS | `EventStreaming` with an ECS consumer | > 900s, heavy compute |

**Constraint:** prefer file-based with Batch/ECS if the real cadence is a nightly batch of large
files. Streaming adds cost and complexity for no benefit there.

## File-based

| Need | Pattern | Construct | Threshold |
|---|---|---|---|
| Small, low-latency drops | Transfer Family → S3 → SQS → Lambda | `FileTransfer` | < 50 MB, < 10k files/day |
| Medium, concurrent | Transfer Family → S3 → SQS → ECS | `FileTransfer` + ECS consumer | 50 MB – 5 GB, > 20 concurrency |
| Nightly batch | EventBridge Scheduled → Step Functions → Batch/ECS | `ProcessManager` | Non-real-time, cost-sensitive (use Spot) |
| Payload too large for the queue | S3 reference passing | `ClaimCheck` | > 256 KB |
| Explode a file into records | Fan-out fragments | `Splitter` | — |

**Constraint:** prefer API or event-driven if consumers need near-real-time, fine-grained updates.

## Database-source

| Need | Pattern | Construct |
|---|---|---|
| Publish DB changes reliably | Outbox row + DynamoDB Streams + Pipes | `Outbox` |
| Scheduled extract to file | Scheduler → Lambda → S3 | `FileTransfer` for the outbound leg |
| Stream change records | Kinesis consumer | `EventStreaming` |

---

# Anti-pattern guardrails

Evaluate every design against these. Report violations even in code the user already wrote.

## API

- Synchronous APIs running beyond 10 seconds. API Gateway timeout risk — move to async with a callback.
- Lambda-to-Lambda chaining for orchestration. Brittle and hard to trace. Use Step Functions via
  `ProcessManager`, `RoutingSlip` or `SagaOrchestration`.
- Long-running processing behind a synchronous API. Poor resilience, timeout failures.
- No circuit breaker or retry strategy. Causes cascading failure. Use `CircuitBreaker` and
  `RetryWithBackoff`; exponential backoff is required.

## Event-driven

- SNS without a DLQ. Silent message loss on failure.
- Event patterns where strict ordering is required. Use SQS FIFO or Kinesis shards.
- Step Functions for a trivial single-step task. Over-engineered and more expensive — call Lambda directly.
- No replay capability. No audit trail, no recovery path. Use `MessageReplayArchive`, or
  EventBridge Archive.

## Streaming

- Streaming for nightly or batch workloads. Unnecessary cost and complexity.
- No DLQ in a streaming pipeline. Failed records block the shard.
- Streaming where ordering matters but partitioning is not set up. Produces inconsistency.

## File-based

- Files over 50 MB in Lambda. Memory and timeout failures. Use Fargate, Glue or Batch.
- Payloads over 256 KB through SQS. Hard limit. Use `ClaimCheck`.
- Polling SQS from Lambda for file workflows. Inefficient and costly — use event triggers.
- File-based integration for real-time needs. Latency too high; use API or event-driven.

## Cross-cutting

- Re-implementing a pattern this library already provides.
- Removing a construct's DLQ, encryption, or PITR defaults without a stated reason.
- Reaching into a construct's underlying CloudFormation instead of using its public readonly members.
