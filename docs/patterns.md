# Patterns Reference

Every construct in the library, grouped by category. Each entry has a diagram of what the construct provisions, a usage example with real props, its position in the Enterprise Integration Patterns taxonomy, and the AWS services underneath.

For which construct to pick, start with the [Pattern Selection Guide](../README.md#pattern-selection-guide) in the README. For end-to-end worked examples, see the [Implementation Guide](implementation-guide.md).

### Messaging Patterns

#### PublishSubscribeSns
One-way fan-out via SNS to multiple SQS queues and Lambda subscribers.

```mermaid
graph LR
    PUB[Publisher EC2/Lambda] -->|grantPublish| SNS[SNS Topic]
    SNS -->|subscribe| Q0[SQS Queue 0]
    SNS -->|subscribe| Q1[SQS Queue 1]
    SNS -->|subscribe| FN[Lambda Subscriber]
    Q0 -.->|failed| DLQ0[DLQ 0]
    Q1 -.->|failed| DLQ1[DLQ 1]
    style SNS fill:#BC1356,color:#fff
    style Q0 fill:#BC1356,color:#fff
    style Q1 fill:#BC1356,color:#fff
    style DLQ0 fill:#8B0000,color:#fff
    style DLQ1 fill:#8B0000,color:#fff
    style FN fill:#D05C17,color:#fff
    style PUB fill:#D05C17,color:#fff
```

```typescript
import { PublishSubscribeSns } from './lib';

// SNS FIFO topics cannot have Lambda subscriptions — pick FIFO + SQS, or standard + Lambda.
new PublishSubscribeSns(this, 'OrderEvents', {
  subscriberQueues: 3,
  publishers: [myEc2Instance.grantPrincipal],
  subscriberLambdas: [{
    handler: 'index.handler',
    code: lambda.Code.fromAsset('lambda/notify'),
  }],
});
```

**EIP Classification:** Messaging → Message Channel → Publish-Subscribe → Message Filter → Message Broadcast

**AWS Services:** SNS, SQS, Lambda

---

#### PublishSubscribeMq
Two-way pub-sub with Amazon MQ (ActiveMQ) and correlation support for request-reply over topics.

```mermaid
graph LR
    PUB[Publisher EC2] -->|publish| MQ[Amazon MQ Topic]
    MQ -->|bridge| QA[Sub Queue A]
    MQ -->|bridge| QB[Sub Queue B]
    QA --> FNA[Lambda A]
    QB --> FNB[Lambda B]
    FNA -->|correlationId| RESP[Response Queue]
    FNB -->|correlationId| RESP
    style MQ fill:#BC1356,color:#fff
    style QA fill:#BC1356,color:#fff
    style QB fill:#BC1356,color:#fff
    style RESP fill:#BC1356,color:#fff
    style FNA fill:#D05C17,color:#fff
    style FNB fill:#D05C17,color:#fff
    style PUB fill:#D05C17,color:#fff
```

```typescript
import { PublishSubscribeMq } from './lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// Secret must contain JSON with `username` and `password` keys; the broker references it
// via {{resolve:secretsmanager:...}} so cleartext never lands in the synthesised template.
const brokerSecret = new secretsmanager.Secret(this, 'MqBrokerSecret', {
  generateSecretString: {
    secretStringTemplate: JSON.stringify({ username: 'admin' }),
    generateStringKey: 'password',
    excludePunctuation: true,
  },
});

const brokerSg = new ec2.SecurityGroup(this, 'MqSg', { vpc: myVpc });

new PublishSubscribeMq(this, 'TradingEvents', {
  vpc: myVpc,
  brokerSecret,
  brokerSecurityGroup: brokerSg,
  subscribers: [
    { name: 'PricingEngine', destination: 'pricing.events',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/pricing') },
    { name: 'RiskEngine', destination: 'risk.events',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/risk') },
  ],
});
```

**EIP Classification:** Messaging → Message Channel → Publish-Subscribe → Correlation Identifier

**AWS Services:** Amazon MQ, SQS, Lambda

---

#### ContentBasedRouter
Routes messages to different targets based on event content inspection via EventBridge rules.

```mermaid
graph LR
    SRC[Source] -->|putEvents| EB[EventBridge Bus]
    EB -->|"rule: order.*"| FN[Lambda A]
    EB -->|"rule: payment.*"| Q[SQS Queue]
    EB -->|"rule: notify.*"| T[SNS Topic]
    EB -.->|failed| DLQ[DLQ]
    style EB fill:#BC1356,color:#fff
    style Q fill:#BC1356,color:#fff
    style T fill:#BC1356,color:#fff
    style DLQ fill:#8B0000,color:#fff
    style FN fill:#D05C17,color:#fff
    style SRC fill:#D05C17,color:#fff
```

```typescript
import { ContentBasedRouter } from './lib';

new ContentBasedRouter(this, 'OrderRouter', {
  rules: [
    {
      eventPattern: { source: ['orders'], detailType: ['OrderCreated'] },
      target: 'lambda',
      lambdaConfig: { handler: 'index.handler', code: lambda.Code.fromAsset('lambda/process') },
    },
    {
      eventPattern: { source: ['orders'], detailType: ['OrderCancelled'] },
      target: 'sqs',
    },
  ],
});
```

**EIP Classification:** Messaging → Content-Based Router

**AWS Services:** EventBridge, Lambda, SQS, SNS

---

### Request-Reply Patterns

#### RequestReply
Asynchronous request-reply over SQS with correlation support.

```mermaid
graph LR
    PROD[Producer EC2] -->|"send + correlationId"| REQ[Request Queue]
    REQ --> CON[Consumer Lambda]
    CON -->|"reply + correlationId"| REP[Reply Queue]
    REP -->|poll| PROD
    REQ -.-> RDLQ[Request DLQ]
    REP -.-> RPDLQ[Reply DLQ]
    style REQ fill:#BC1356,color:#fff
    style REP fill:#BC1356,color:#fff
    style RDLQ fill:#8B0000,color:#fff
    style RPDLQ fill:#8B0000,color:#fff
    style CON fill:#D05C17,color:#fff
    style PROD fill:#D05C17,color:#fff
```

```typescript
import { RequestReply } from './lib';

new RequestReply(this, 'PaymentProcessor', {
  consumerHandler: 'index.handler',
  consumerCode: lambda.Code.fromAsset('lambda/payment'),
});
```

**EIP Classification:** Messaging → Message Channel → Polling Consumer → Correlation Identifier → Request/Reply

**AWS Services:** SQS (request + reply queues), Lambda

---

#### RequestReplyMq
Request-reply over Amazon MQ for JMS/AMQP compatibility.

```mermaid
graph LR
    PROD[Producer EC2] -->|send| MQR[MQ Request Queue]
    MQR -->|consume| CON[Consumer]
    CON -->|reply| MQRP[MQ Reply Queue]
    MQRP -->|poll| PROD
    style MQR fill:#BC1356,color:#fff
    style MQRP fill:#BC1356,color:#fff
    style CON fill:#D05C17,color:#fff
    style PROD fill:#D05C17,color:#fff
```

```typescript
import { RequestReplyMq } from './lib';

new RequestReplyMq(this, 'LegacyBridge', {
  vpc: myVpc,
  brokerSecret,
  brokerSecurityGroup: brokerSg,
  requestDestination: 'requests',
  replyDestination: 'replies',
});
```

**AWS Services:** Amazon MQ (ActiveMQ), SQS

---

#### RequestReplyLargePayload
Request-reply with S3 claim check for payloads exceeding 256KB.

```mermaid
graph LR
    PROD[Producer] -->|claim token| REQ[Request Queue]
    PROD -->|store payload| S3[S3 Bucket]
    REQ --> CON[Consumer Lambda]
    CON -->|read payload| S3
    CON -->|reply| REP[Reply Queue]
    style REQ fill:#BC1356,color:#fff
    style REP fill:#BC1356,color:#fff
    style S3 fill:#3F8624,color:#fff
    style CON fill:#D05C17,color:#fff
    style PROD fill:#D05C17,color:#fff
```

```typescript
import { RequestReplyLargePayload } from './lib';

new RequestReplyLargePayload(this, 'DocumentProcessor', {
  consumerHandler: 'index.handler',
  consumerCode: lambda.Code.fromAsset('lambda/docs'),
});
```

**EIP Classification:** Messaging → Claim Check → Request/Reply → Correlation Identifier

**AWS Services:** SQS, S3, Lambda

---

### Routing & Transformation Patterns

#### ScatterGather
Broadcasts a request to multiple recipients and correlates their responses via DynamoDB.

```mermaid
graph LR
    REQ[Request] -->|broadcast| SNS[SNS Topic]
    SNS --> R0[Recipient 0]
    SNS --> R1[Recipient 1]
    SNS --> R2[Recipient 2]
    R0 -->|write response| DDB[DynamoDB Correlation Table]
    R1 -->|write response| DDB
    R2 -->|write response| DDB
    DDB -->|stream trigger| AGG[Aggregator Lambda]
    style SNS fill:#BC1356,color:#fff
    style DDB fill:#4053D6,color:#fff
    style R0 fill:#D05C17,color:#fff
    style R1 fill:#D05C17,color:#fff
    style R2 fill:#D05C17,color:#fff
    style AGG fill:#D05C17,color:#fff
```

```typescript
import { ScatterGather } from './lib';

new ScatterGather(this, 'SupplierQuotes', {
  recipientCount: 4,
  recipientHandler: 'index.handler',
  recipientCode: lambda.Code.fromAsset('lambda/supplier'),
  aggregatorHandler: 'index.handler',
  aggregatorCode: lambda.Code.fromAsset('lambda/best-quote'),
  gatherTtlSeconds: 60,
});
```

**EIP Classification:** Messaging → Scatter-Gather → Broadcast → Correlation Identifier → Request/Reply

**AWS Services:** SNS, Lambda, DynamoDB (correlation table with streams)

---

#### Aggregator
Collects fine-grained messages into batches using DynamoDB state with TTL-based completion.

```mermaid
graph LR
    A[Source A] --> Q[Ingest Queue]
    B[Source B] --> Q
    Q --> COL[Collector Lambda]
    COL -->|"write by batchId"| DDB[DynamoDB State Table]
    DDB -->|"stream: TTL/complete"| PROC[Processor Lambda]
    style Q fill:#BC1356,color:#fff
    style DDB fill:#4053D6,color:#fff
    style COL fill:#D05C17,color:#fff
    style PROC fill:#D05C17,color:#fff
```

```typescript
import { Aggregator } from './lib';

new Aggregator(this, 'BatchCollector', {
  collectorHandler: 'index.handler',
  collectorCode: lambda.Code.fromAsset('lambda/collect'),
  processorHandler: 'index.handler',
  processorCode: lambda.Code.fromAsset('lambda/process-batch'),
  ttlSeconds: 300,
});
```

**EIP Classification:** Messaging → Aggregator → Polling Consumer

**AWS Services:** SQS, Lambda, DynamoDB (state table with streams + TTL)

---

#### Splitter
Breaks a composite message into individual fragments and fans out via SNS.

```mermaid
graph LR
    IN[Input Queue] --> SPL[Splitter Lambda]
    SPL -->|publish fragments| SNS[Output Topic]
    SNS --> Q0[Output Queue 0]
    SNS --> Q1[Output Queue 1]
    style IN fill:#BC1356,color:#fff
    style SNS fill:#BC1356,color:#fff
    style Q0 fill:#BC1356,color:#fff
    style Q1 fill:#BC1356,color:#fff
    style SPL fill:#D05C17,color:#fff
```

```typescript
import { Splitter } from './lib';

new Splitter(this, 'OrderSplitter', {
  splitterHandler: 'index.handler',
  splitterCode: lambda.Code.fromAsset('lambda/split'),
  outputQueueCount: 3,
});
```

**EIP Classification:** Messaging → Splitter → Polling Consumer

**AWS Services:** SQS, Lambda, SNS

---

#### Resequencer
Reorders out-of-sequence messages using DynamoDB state keyed by batchId + sequenceId.

```mermaid
graph LR
    IN[Input Queue] --> COL[Collector Lambda]
    COL -->|"write by sequenceId"| DDB[DynamoDB State Table]
    DDB -->|stream trigger| DSP[Dispatcher Lambda]
    DSP -->|ordered output| OUT[Output Queue]
    style IN fill:#BC1356,color:#fff
    style OUT fill:#BC1356,color:#fff
    style DDB fill:#4053D6,color:#fff
    style COL fill:#D05C17,color:#fff
    style DSP fill:#D05C17,color:#fff
```

```typescript
import { Resequencer } from './lib';

new Resequencer(this, 'OrderResequencer', {
  collectorHandler: 'index.handler',
  collectorCode: lambda.Code.fromAsset('lambda/collect'),
  dispatcherHandler: 'index.handler',
  dispatcherCode: lambda.Code.fromAsset('lambda/dispatch'),
  ttlSeconds: 120,
});
```

**EIP Classification:** Messaging → Resequencer → Polling Consumer

**AWS Services:** SQS, Lambda, DynamoDB (state table with streams + TTL)

---

#### ContentEnricher
Enriches messages by calling external services or databases before forwarding.

```mermaid
graph LR
    IN[Input Queue] --> ENR[Enricher Lambda]
    ENR -->|lookup| EXT[External API / DB]
    ENR -->|enriched msg| OUT[Output Queue]
    API[API Gateway] -.->|optional| ENR
    style IN fill:#BC1356,color:#fff
    style OUT fill:#BC1356,color:#fff
    style ENR fill:#D05C17,color:#fff
    style API fill:#5A30B5,color:#fff
```

```typescript
import { ContentEnricher } from './lib';

new ContentEnricher(this, 'CustomerEnricher', {
  enricherHandler: 'index.handler',
  enricherCode: lambda.Code.fromAsset('lambda/enrich'),
  createApi: true,
});
```

**EIP Classification:** Messaging → Content Enricher → Message Channel

**AWS Services:** SQS, Lambda, API Gateway (optional)

---

### API Composition Patterns

#### ApiCompositionAppSync
Synchronous aggregation via AppSync GraphQL with unit and pipeline resolvers.

```mermaid
graph LR
    CLI[Client] -->|GraphQL query| AS[AppSync API]
    AS -->|unit resolver| FN[Lambda]
    AS -->|unit resolver| DDB[DynamoDB]
    AS -->|pipeline resolver| P1[Step 1: Lambda]
    P1 -->|ctx.prev.result| P2[Step 2: DynamoDB]
    style AS fill:#BC1356,color:#fff
    style DDB fill:#4053D6,color:#fff
    style P2 fill:#4053D6,color:#fff
    style FN fill:#D05C17,color:#fff
    style P1 fill:#D05C17,color:#fff
```

```typescript
import { ApiCompositionAppSync } from './lib';

new ApiCompositionAppSync(this, 'ProductApi', {
  schemaPath: 'schema.graphql',
  resolvers: [
    { typeName: 'Query', fieldName: 'getUser', kind: 'lambda',
      lambdaConfig: { handler: 'index.handler', code: lambda.Code.fromAsset('lambda/user') } },
    { typeName: 'Query', fieldName: 'getOrders', kind: 'dynamodb' },
  ],
  pipelineResolvers: [{
    typeName: 'Query',
    fieldName: 'getUserWithOrders',
    steps: [0, 1],  // calls resolver 0 then resolver 1 in sequence
  }],
});
```

**EIP Classification:** API Composition (Sync Aggregator) → Pipeline Resolver

**AWS Services:** AppSync, Lambda, DynamoDB

---

#### ApiCompositionApollo
Apollo Federation gateway on ECS Fargate behind an ALB.

```mermaid
graph LR
    CLI[Client] -->|GraphQL| ALB[ALB]
    ALB --> GW[ECS Fargate: Apollo Gateway]
    GW --> SA[Subgraph A]
    GW --> SB[Subgraph B]
    style ALB fill:#5A30B5,color:#fff
    style GW fill:#D05C17,color:#fff
```

```typescript
import { ApiCompositionApollo } from './lib';

new ApiCompositionApollo(this, 'FederatedGateway', {
  vpc: myVpc,
  containerImage: ecs.ContainerImage.fromAsset('docker/apollo-gateway'),
  desiredCount: 2,
  certificate: myAcmCert,    // strongly recommended — terminates HTTPS + redirects HTTP
  publicLoadBalancer: false, // keep internal unless edge auth fronts the gateway
});
```

**AWS Services:** ECS Fargate, ALB

---

### Event & Streaming Patterns

#### EventStreaming
Kinesis-based event streaming for CQRS and audit logging.

```mermaid
graph LR
    SVC_A[Microservice A] -->|putRecord| KIN[Kinesis Data Stream]
    SVC_B[Microservice B] -->|putRecord| KIN
    KIN --> CON[Consumer Lambda]
    CON -->|write audit| DDB[DynamoDB Audit Table]
    style KIN fill:#945DF2,color:#fff
    style DDB fill:#4053D6,color:#fff
    style CON fill:#D05C17,color:#fff
```

```typescript
import { EventStreaming } from './lib';

new EventStreaming(this, 'AuditStream', {
  shardCount: 2,
  consumerHandler: 'index.handler',
  consumerCode: lambda.Code.fromAsset('lambda/audit'),
  retentionPeriodHours: 168,
});
```

**EIP Classification:** Messaging → Message Channel → Event Streaming (CQRS)

**AWS Services:** Kinesis Data Streams, Lambda, DynamoDB

---

#### ClaimCheck
Stores large payloads in S3 and passes claim tokens through SQS.

```mermaid
graph LR
    IN[Input Queue] --> CI[Checkin Lambda]
    CI -->|store payload| S3[S3 Bucket]
    CI -->|claim token| OUT[Output Queue]
    OUT --> CO[Checkout Lambda]
    CO -->|retrieve payload| S3
    style IN fill:#BC1356,color:#fff
    style OUT fill:#BC1356,color:#fff
    style S3 fill:#3F8624,color:#fff
    style CI fill:#D05C17,color:#fff
    style CO fill:#D05C17,color:#fff
```

```typescript
import { ClaimCheck } from './lib';

new ClaimCheck(this, 'LargePayload', {
  checkinHandler: 'index.handler',
  checkinCode: lambda.Code.fromAsset('lambda/checkin'),
  checkoutHandler: 'index.handler',
  checkoutCode: lambda.Code.fromAsset('lambda/checkout'),
});
```

**EIP Classification:** Messaging → Claim Check

**AWS Services:** SQS, S3, Lambda

---

#### MessageReplayArchive
Archives all messages to S3 with DynamoDB metadata and provides an API for replay.

```mermaid
graph LR
    PUB[Publisher] --> SNS[SNS Topic]
    SNS --> AQ[Archive Queue]
    SNS --> SQ[Subscriber Queue]
    AQ --> AR[Archiver Lambda]
    AR --> S3[S3 Archive]
    AR --> DDB[DynamoDB Metadata]
    API[API Gateway /replay] --> RP[Replayer Lambda]
    RP -->|read| S3
    RP -->|republish| SNS
    style SNS fill:#BC1356,color:#fff
    style AQ fill:#BC1356,color:#fff
    style SQ fill:#BC1356,color:#fff
    style S3 fill:#3F8624,color:#fff
    style DDB fill:#4053D6,color:#fff
    style API fill:#5A30B5,color:#fff
    style AR fill:#D05C17,color:#fff
    style RP fill:#D05C17,color:#fff
```

```typescript
import { MessageReplayArchive } from './lib';

new MessageReplayArchive(this, 'OrderArchive', {
  archiveHandler: 'index.handler',
  archiveCode: lambda.Code.fromAsset('lambda/archive'),
  replayHandler: 'index.handler',
  replayCode: lambda.Code.fromAsset('lambda/replay'),
  subscriberQueueCount: 2,
});
```

**Replay API Endpoints (IAM-authenticated by default — pass `apiAuthorizer` for a custom authorizer):**
- `GET /messageArchive/by-date/{date}` — retrieve archived messages by date
- `POST /messageArchive/replay/{messageId}` — republish a specific message

**AWS Services:** SNS, SQS, S3, DynamoDB, API Gateway, Lambda

---

### Saga Patterns

#### SagaChoreography
Event-driven saga with compensation chain. Each step publishes to success or failure topics. Failure propagates backward through compensation functions for full rollback.

```mermaid
graph TB
    subgraph Forward Chain
        Q1[Step1 Queue] --> F1[Step1 Fn]
        F1 -->|success| ST1[Step1 Success Topic]
        ST1 --> Q2[Step2 Queue]
        Q2 --> F2[Step2 Fn]
        F2 -->|success| ST2[Step2 Success Topic]
    end
    subgraph Compensation Chain
        F2 -->|failure| FT2[Step2 Failure Topic]
        FT2 --> CQ2[Step2 Comp Queue]
        CQ2 --> CF2[Step2 Compensate]
        CF2 -->|propagate| FT1[Step1 Failure Topic]
        F1 -->|failure| FT1
        FT1 --> CQ1[Step1 Comp Queue]
        CQ1 --> CF1[Step1 Compensate]
    end
    style Q1 fill:#BC1356,color:#fff
    style Q2 fill:#BC1356,color:#fff
    style ST1 fill:#BC1356,color:#fff
    style ST2 fill:#BC1356,color:#fff
    style FT1 fill:#8B0000,color:#fff
    style FT2 fill:#8B0000,color:#fff
    style CQ1 fill:#8B0000,color:#fff
    style CQ2 fill:#8B0000,color:#fff
    style F1 fill:#D05C17,color:#fff
    style F2 fill:#D05C17,color:#fff
    style CF1 fill:#D05C17,color:#fff
    style CF2 fill:#D05C17,color:#fff
```

```typescript
import { SagaChoreography } from './lib';

new SagaChoreography(this, 'OrderSaga', {
  steps: [
    { name: 'ReserveStock',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/reserve'),
      compensationHandler: 'index.handler', compensationCode: lambda.Code.fromAsset('lambda/unreserve') },
    { name: 'ChargePayment',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/charge'),
      compensationHandler: 'index.handler', compensationCode: lambda.Code.fromAsset('lambda/refund') },
    { name: 'ShipOrder',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/ship'),
      compensationHandler: 'index.handler', compensationCode: lambda.Code.fromAsset('lambda/cancel-ship') },
  ],
});
```

**Flow:**
```
Entry → Step1 Queue → Step1 Fn ──success──→ Step2 Queue → Step2 Fn ──success──→ Step3
                         │                                    │
                       failure                              failure
                         ↓                                    ↓
                   Step1 Failure Topic                  Step2 Failure Topic
                         ↓                                    ↓
                   Step1 Comp Queue                     Step2 Comp Queue
                         ↓                                    ↓
                   Step1 Compensate ←──propagate──── Step2 Compensate
```

**EIP Classification:** Messaging → Saga (Event Choreography) → Compensation

**AWS Services:** SNS (success + failure topics per step), SQS, Lambda

---

#### SagaOrchestration
Centrally orchestrated saga using Step Functions with try/catch compensation.

```mermaid
graph TB
    Q[State Queue] --> ORCH[Orchestrator Lambda]
    ORCH -->|startExecution| SF[Step Functions]
    SF --> S1[Step 1]
    S1 -->|success| S2[Step 2]
    S2 -->|success| S3[Step 3]
    S1 -->|catch| C1[Compensate 1]
    S2 -->|catch| C2[Compensate 2]
    S3 -->|catch| C3[Compensate 3]
    style Q fill:#BC1356,color:#fff
    style SF fill:#D05C17,color:#fff
    style ORCH fill:#D05C17,color:#fff
    style S1 fill:#D05C17,color:#fff
    style S2 fill:#D05C17,color:#fff
    style S3 fill:#D05C17,color:#fff
    style C1 fill:#8B0000,color:#fff
    style C2 fill:#8B0000,color:#fff
    style C3 fill:#8B0000,color:#fff
```

```typescript
import { SagaOrchestration } from './lib';

new SagaOrchestration(this, 'FulfilmentSaga', {
  steps: [
    { name: 'ReserveStock', handler: 'index.handler', code: lambda.Code.fromAsset('lambda/reserve'),
      compensationHandler: 'index.handler', compensationCode: lambda.Code.fromAsset('lambda/unreserve') },
    { name: 'ChargePayment', handler: 'index.handler', code: lambda.Code.fromAsset('lambda/charge'),
      compensationHandler: 'index.handler', compensationCode: lambda.Code.fromAsset('lambda/refund') },
    { name: 'ShipOrder', handler: 'index.handler', code: lambda.Code.fromAsset('lambda/ship') },
  ],
});
```

**EIP Classification:** Messaging → Saga (Event Orchestration) → Step Functions

**AWS Services:** Step Functions, SQS, Lambda

---

### Reliability & Governance Patterns

#### IdempotentReceiver
Wraps a consumer with a DynamoDB-backed dedup table so duplicate deliveries are safely ignored.

```mermaid
graph LR
    IN[Input Queue] --> H[Handler Lambda]
    H -->|conditional put| DDB[Dedup Table]
    DDB -.->|TTL expiry| GC[(auto cleanup)]
    style IN fill:#BC1356,color:#fff
    style DDB fill:#4053D6,color:#fff
    style H fill:#D05C17,color:#fff
```

```typescript
import { IdempotentReceiver } from './lib';

new IdempotentReceiver(this, 'OrderConsumer', {
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/order-consumer'),
  idAttributeName: 'orderId',
  dedupTtlSeconds: 86400,
});
```

**Env injected:** `DEDUP_TABLE`, `DEDUP_ID_ATTRIBUTE`, `DEDUP_TTL_SECONDS`. Use AWS Lambda Powertools `idempotency` against the table for plug-and-play dedup.

**EIP Classification:** Messaging Endpoints → Idempotent Receiver

**AWS Services:** SQS, DynamoDB (TTL), Lambda

---

#### WireTap
Mirrors EventBridge bus traffic to an S3 audit archive via Firehose without affecting consumers.

```mermaid
graph LR
    BUS[EventBridge Bus] -->|main flow| CONS[Consumers]
    BUS -->|tap rule| FH[Firehose]
    FH -->|partitioned by date| S3[S3 Audit]
    style BUS fill:#BC1356,color:#fff
    style FH fill:#945DF2,color:#fff
    style S3 fill:#3F8624,color:#fff
```

```typescript
import { WireTap } from './lib';

new WireTap(this, 'AuditTap', {
  eventBus: myBus,
  eventPattern: { source: ['orders', 'payments'] },
  archiveExpirationDays: 365,
});
```

**EIP Classification:** Systems Management → Wire Tap

**AWS Services:** EventBridge, Kinesis Firehose, S3

---

#### MessageFilter
Drops messages that do not match a predicate. Declarative EventBridge rule, no Lambda hop unless one is the target.

```typescript
import { MessageFilter } from './lib';

new MessageFilter(this, 'HighValueOrders', {
  eventBus: myBus,
  eventPattern: {
    source: ['orders'],
    detail: { totalCents: [{ numeric: ['>=', 100000] }] },
  },
  target: 'sqs',
});
```

**EIP Classification:** Message Routing → Message Filter

**AWS Services:** EventBridge, SQS / SNS / Lambda

---

#### Outbox
Transactional Outbox over DynamoDB Streams + EventBridge Pipes. Producers write outbox rows in the same transaction as business state; the pipe relays them to SNS.

```mermaid
graph LR
    APP[App Code] -->|"transactWrite (state + outbox)"| DDB[Outbox Table]
    DDB -->|streams: INSERT only| PIPE[EventBridge Pipe]
    PIPE --> TOPIC[SNS Topic]
    PIPE -.->|on failure| DLQ[Pipe DLQ]
    style DDB fill:#4053D6,color:#fff
    style PIPE fill:#945DF2,color:#fff
    style TOPIC fill:#BC1356,color:#fff
    style DLQ fill:#8B0000,color:#fff
```

```typescript
import { Outbox } from './lib';

const outbox = new Outbox(this, 'OrderOutbox');
// Producer writes business state + outbox row in one TransactWriteItems.
new CfnOutput(this, 'OutboxTable', { value: outbox.outboxTable.tableName });
new CfnOutput(this, 'OutboxTopic', { value: outbox.topic.topicArn });
```

**EIP Classification:** Modern Cloud → Transactional Outbox

**AWS Services:** DynamoDB (Streams), EventBridge Pipes, SNS, SQS (DLQ)

---

#### MessageTranslator
Format / schema conversion. Caller-supplied translator Lambda receives source-format messages and emits canonical-format messages on the output queue.

```typescript
import { MessageTranslator } from './lib';

new MessageTranslator(this, 'PartnerOrderMapper', {
  translatorHandler: 'index.handler',
  translatorCode: lambda.Code.fromAsset('lambda/translate'),
  sourceSchema: 'xml/partner-order/v1',
  targetSchema: 'json/canonical-order/v2',
  schemaRegistryName: 'integration-registry',
  schemaName: 'CanonicalOrder',
});
```

**Env injected:** `OUTPUT_QUEUE_URL`, `SOURCE_SCHEMA`, `TARGET_SCHEMA`, `SCHEMA_REGISTRY_NAME`, `SCHEMA_NAME`.

**EIP Classification:** Message Transformation → Message Translator

**AWS Services:** SQS, Lambda (+ optional Glue Schema Registry)

---

#### FileTransfer
SFTP/FTPS file ingestion via AWS Transfer Family into an S3 landing bucket, fanned out via EventBridge with an optional ingestion Lambda.

```mermaid
graph LR
    PRT[Partner SFTP Client] --> SRV[Transfer Family Server]
    SRV --> LAND[S3 Landing Bucket]
    LAND --> EB[EventBridge]
    EB --> ING[Ingestion Lambda]
    style SRV fill:#5A30B5,color:#fff
    style LAND fill:#3F8624,color:#fff
    style EB fill:#BC1356,color:#fff
    style ING fill:#D05C17,color:#fff
```

```typescript
import { FileTransfer } from './lib';

const ft = new FileTransfer(this, 'PartnerSftp', {
  protocol: 'SFTP',
  fileRetentionDays: 30,
  ingestionHandler: 'index.handler',
  ingestionCode: lambda.Code.fromAsset('lambda/ingest'),
});
// Add SFTP users separately, e.g.:
// new transfer.CfnUser(this, 'PartnerA', {
//   serverId: ft.server.attrServerId,
//   userName: 'partner-a',
//   role: ft.userRole.roleArn,
//   homeDirectory: `/${ft.landingBucket.bucketName}/partner-a`,
// });
```

**EIP Classification:** Integration Styles → File Transfer

**AWS Services:** AWS Transfer Family, S3, EventBridge, Lambda

---

#### Throttling
Two-layer rate limiter: SQS-fronted worker with reserved concurrency (downstream protection) and an optional API Gateway facade with a usage plan (partner protection).

```typescript
import { Throttling } from './lib';

new Throttling(this, 'PartnerApiThrottle', {
  workerHandler: 'index.handler',
  workerCode: lambda.Code.fromAsset('lambda/call-partner'),
  workerReservedConcurrency: 10,
  createApi: true,
  rateLimitRps: 50,
  burstLimit: 100,
  dailyQuota: 1_000_000,
});
```

**EIP Classification:** Modern Cloud → Throttling / Rate Limiter

**AWS Services:** SQS, Lambda (reserved concurrency), API Gateway (usage plans)

---

#### CircuitBreaker
DynamoDB-backed breaker state in front of a downstream call. Caller's Lambda reads/writes breaker state with the surfaced env vars; AWS Lambda Powertools `circuit-breaker` style logic plugs straight in.

```typescript
import { CircuitBreaker } from './lib';

new CircuitBreaker(this, 'PaymentGatewayBreaker', {
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/charge'),
  failureThreshold: 5,
  cooldownSeconds: 30,
  breakerKey: 'payment-gateway-v1',
});
```

**EIP Classification:** Modern Cloud → Circuit Breaker

**AWS Services:** SQS, DynamoDB (TTL), Lambda

---

#### RetryWithBackoff
SQS-driven retry with configurable visibility-timeout backoff. Worker throws on transient failure; SQS redrives. Worker may extend visibility for adaptive exponential backoff.

```typescript
import { RetryWithBackoff } from './lib';

new RetryWithBackoff(this, 'PartnerWebhook', {
  workerHandler: 'index.handler',
  workerCode: lambda.Code.fromAsset('lambda/webhook'),
  initialVisibilityTimeoutSeconds: 30,
  backoffMultiplier: 2,
  maxVisibilityTimeoutSeconds: 900,
  maxAttempts: 6,
});
```

**Env injected:** `QUEUE_URL`, `RETRY_INITIAL_SECONDS`, `RETRY_MULTIPLIER`, `RETRY_MAX_SECONDS`, `RETRY_MAX_ATTEMPTS`.

**EIP Classification:** Modern Cloud → Retry with Backoff

**AWS Services:** SQS, Lambda

---

#### ProcessManager
Linear, centrally orchestrated workflow without compensation. Use when "stop on failure" is acceptable — approval workflows, ingestion pipelines, BPM-lite. Reach for `SagaOrchestration` if you need rollback.

```typescript
import { ProcessManager } from './lib';

new ProcessManager(this, 'OnboardingFlow', {
  steps: [
    { name: 'Validate', handler: 'index.handler', code: lambda.Code.fromAsset('lambda/validate'), maxRetries: 2 },
    { name: 'Provision', handler: 'index.handler', code: lambda.Code.fromAsset('lambda/provision') },
    { name: 'Notify',   handler: 'index.handler', code: lambda.Code.fromAsset('lambda/notify') },
  ],
});
```

**EIP Classification:** Message Routing → Process Manager

**AWS Services:** Step Functions, SQS, Lambda

---

#### RoutingSlip
Producer-supplied itinerary array dictates the order of steps at runtime. Step Functions Map iterates the slip; a dispatcher invokes the matching step's Lambda.

```typescript
import { RoutingSlip } from './lib';

new RoutingSlip(this, 'OrderSlip', {
  steps: [
    { name: 'validate', handler: 'index.handler', code: lambda.Code.fromAsset('lambda/validate') },
    { name: 'enrich',   handler: 'index.handler', code: lambda.Code.fromAsset('lambda/enrich') },
    { name: 'publish',  handler: 'index.handler', code: lambda.Code.fromAsset('lambda/publish') },
  ],
});
// Producer sends:
//   { "itinerary": ["validate", "enrich", "publish"], "payload": { ... } }
```

**EIP Classification:** Message Routing → Routing Slip

**AWS Services:** Step Functions (Map), SQS, Lambda

---
