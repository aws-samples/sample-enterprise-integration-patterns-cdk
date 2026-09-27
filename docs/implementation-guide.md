# Implementation Guide

This section walks through how to implement each pattern end-to-end. It explains what the construct creates, what you need to provide, and how messages flow through the system.

---

### Implementing Request-Reply

**Scenario:** Your order service (EC2) needs to send a payment request and wait for a response.

**What the construct creates for you:**

| Resource | Name | Purpose |
|---|---|---|
| SQS Queue | `RequestQueue` | Producer sends payment requests here |
| SQS Queue | `ReplyQueue` | Consumer sends responses back here |
| SQS Queue | `RequestDLQ` | Failed requests land here after 3 attempts |
| SQS Queue | `ReplyDLQ` | Failed replies land here after 3 attempts |
| Lambda | `Consumer` | Your business logic that processes requests |
| IAM Permissions | — | Consumer can read RequestQueue + write to ReplyQueue |
| Event Source | — | Consumer is automatically triggered by RequestQueue |

**What you provide:**

```typescript
new RequestReply(this, 'PaymentProcessor', {
  // REQUIRED: Your Lambda handler that processes the request and sends a reply
  consumerHandler: 'index.handler',
  consumerCode: lambda.Code.fromAsset('lambda/payment'),

  // OPTIONAL: Override defaults
  consumerRuntime: lambda.Runtime.NODEJS_20_X,
  deadLetterQueue: {
    maxReceiveCount: 5,        // retry 5 times before DLQ (default: 3)
    retentionPeriodDays: 7,    // keep DLQ messages 7 days (default: 14)
  },
});
```

**Your consumer Lambda must:**

1. Read the request from the SQS event
2. Process it (call payment gateway, validate, etc.)
3. Send the response to the reply queue using the `REPLY_QUEUE_URL` environment variable
4. Include the `correlationId` from the original request so the producer can match it

```typescript
// lambda/payment/index.ts
import { SQSEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient();

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const request = JSON.parse(record.body);

    // Your business logic
    const result = await processPayment(request);

    // Send reply with the same correlationId
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.REPLY_QUEUE_URL,
      MessageBody: JSON.stringify({
        correlationId: request.correlationId,
        status: result.status,
        transactionId: result.transactionId,
      }),
    }));
  }
};
```

**Your producer (EC2/ECS app) must:**

1. Generate a unique `correlationId`
2. Send the request to the RequestQueue
3. Poll the ReplyQueue filtering by `correlationId`

```typescript
// Producer-side code (runs on EC2/ECS)
import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';

const sqs = new SQSClient();
const correlationId = randomUUID();

// Send request
await sqs.send(new SendMessageCommand({
  QueueUrl: requestQueueUrl,  // from stack outputs
  MessageBody: JSON.stringify({
    correlationId,
    orderId: 'ORD-123',
    amount: 99.99,
  }),
}));

// Poll for reply (with timeout)
const reply = await pollForReply(replyQueueUrl, correlationId, timeoutMs: 30000);
```

**How to get the queue URLs into your producer:**

```typescript
// In your CDK stack
const rr = new RequestReply(this, 'PaymentProcessor', { ... });

// Export as stack outputs so your producer app can read them
new CfnOutput(this, 'RequestQueueUrl', { value: rr.requestQueue.queueUrl });
new CfnOutput(this, 'ReplyQueueUrl', { value: rr.replyQueue.queueUrl });

// Or pass to an EC2 instance via user data / SSM parameter
new ssm.StringParameter(this, 'RequestQueueParam', {
  parameterName: '/myapp/payment/request-queue-url',
  stringValue: rr.requestQueue.queueUrl,
});
```

---

### Implementing Publish-Subscribe (SNS)

**Scenario:** Your order service publishes events and multiple downstream services need to react independently.

**What the construct creates:**

| Resource | Purpose |
|---|---|
| SNS Topic | Central event bus — all events published here |
| SQS Queue 0..N | One per subscriber — each gets a copy of every message |
| SQS DLQ 0..N | One per subscriber queue — catches processing failures |
| Lambda 0..N | Optional subscriber functions triggered by their queue |
| IAM Permissions | Publishers can write to topic, queues subscribe to topic |

**What you provide:**

```typescript
const orderEvents = new PublishSubscribeSns(this, 'OrderEvents', {
  // How many independent SQS subscriber queues?
  subscriberQueues: 3,

  // Which services can publish to this topic?
  publishers: [orderService.role, inventoryService.role],

  // Optional: Lambda functions that auto-subscribe
  subscriberLambdas: [{
    handler: 'index.handler',
    code: lambda.Code.fromAsset('lambda/send-email'),
  }],
});

// Queue 0 → Inventory service polls this
// Queue 1 → Analytics service polls this
// Queue 2 → Audit service polls this
// Lambda 0 → Email notification (auto-triggered)

// Export queue URLs so each downstream service knows where to poll
new CfnOutput(this, 'InventoryQueueUrl', { value: orderEvents.queues[0].queueUrl });
new CfnOutput(this, 'AnalyticsQueueUrl', { value: orderEvents.queues[1].queueUrl });
new CfnOutput(this, 'AuditQueueUrl', { value: orderEvents.queues[2].queueUrl });
```

**Your publisher sends events like this:**

```typescript
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

await new SNSClient().send(new PublishCommand({
  TopicArn: process.env.ORDER_TOPIC_ARN,  // from stack outputs
  Message: JSON.stringify({ orderId: 'ORD-123', status: 'CREATED' }),
  MessageAttributes: {
    eventType: { DataType: 'String', StringValue: 'OrderCreated' },
  },
}));
```

---

### Implementing Scatter-Gather

**Scenario:** You need quotes from 4 suppliers and want to pick the best one.

**What the construct creates:**

| Resource | Purpose |
|---|---|
| SNS Topic | Broadcasts the quote request to all recipients |
| Lambda Recipient 0..N | Each calls a different supplier API |
| DynamoDB Table | Correlation table — tracks which responses have arrived |
| DynamoDB Stream | Triggers aggregator when new responses arrive |
| Lambda Aggregator | Checks if all responses arrived, picks the best |

**What you provide:**

```typescript
new ScatterGather(this, 'SupplierQuotes', {
  recipientCount: 4,
  gatherTtlSeconds: 60,  // timeout if not all respond in 60s

  // Each recipient Lambda receives the broadcast and writes its response
  recipientHandler: 'index.handler',
  recipientCode: lambda.Code.fromAsset('lambda/call-supplier'),

  // Aggregator fires when all 4 respond (or TTL expires)
  aggregatorHandler: 'index.handler',
  aggregatorCode: lambda.Code.fromAsset('lambda/pick-best'),
});
```

**Your recipient Lambda must:**

```typescript
// lambda/call-supplier/index.ts
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient();

export const handler = async (event: any) => {
  const request = JSON.parse(event.Records[0].Sns.Message);

  // Call your supplier API
  const quote = await callSupplierApi(request);

  // Write response to correlation table
  await ddb.send(new PutItemCommand({
    TableName: process.env.CORRELATION_TABLE,
    Item: {
      correlationId: { S: request.correlationId },
      recipientId: { S: process.env.RECIPIENT_ID },
      response: { S: JSON.stringify(quote) },
      ttl: { N: String(Math.floor(Date.now() / 1000) + Number(process.env.TTL_SECONDS)) },
    },
  }));
};
```

**Your aggregator Lambda receives DynamoDB stream events:**

```typescript
// lambda/pick-best/index.ts
export const handler = async (event: any) => {
  // Check how many responses exist for this correlationId
  // If all EXPECTED_RESPONSES have arrived, pick the best quote
  // If TTL expired, work with whatever responses you have
};
```

---

### Implementing Saga Choreography

**Scenario:** Order fulfilment requires Reserve Stock → Charge Payment → Ship. If any step fails, all previous steps must roll back.

**What the construct creates per step:**

| Resource | Purpose |
|---|---|
| SNS Success Topic | Step publishes here on success → triggers next step |
| SNS Failure Topic | Step publishes here on failure → triggers compensation |
| SQS Queue | Receives messages from previous step's success topic |
| SQS Compensation Queue | Receives messages from this step's failure topic |
| Lambda Function | Your step business logic |
| Lambda Compensation | Your rollback logic |

**What each step Lambda must do:**

```typescript
// lambda/charge/index.ts — Step function
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient();

export const handler = async (event: any) => {
  const message = JSON.parse(event.Records[0].body);

  try {
    const result = await chargePayment(message);

    // SUCCESS → publish to success topic (triggers next step)
    await sns.send(new PublishCommand({
      TopicArn: process.env.SUCCESS_TOPIC_ARN,
      Message: JSON.stringify({ ...message, paymentId: result.id }),
    }));
  } catch (error) {
    // FAILURE → publish to failure topic (triggers compensation)
    await sns.send(new PublishCommand({
      TopicArn: process.env.FAILURE_TOPIC_ARN,
      Message: JSON.stringify({ ...message, error: error.message }),
    }));
  }
};
```

```typescript
// lambda/refund/index.ts — Compensation function
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient();

export const handler = async (event: any) => {
  const message = JSON.parse(event.Records[0].body);

  // Undo this step
  await refundPayment(message.paymentId);

  // Propagate failure backward to previous step's compensation
  if (process.env.PREV_FAILURE_TOPIC_ARN) {
    await sns.send(new PublishCommand({
      TopicArn: process.env.PREV_FAILURE_TOPIC_ARN,
      Message: JSON.stringify(message),
    }));
  }
};
```

**Environment variables injected automatically:**

| Variable | Available In | Value |
|---|---|---|
| `SUCCESS_TOPIC_ARN` | Step functions | This step's success topic |
| `FAILURE_TOPIC_ARN` | Step functions | This step's failure topic |
| `STEP_NAME` | Step functions | Name of this step |
| `PREV_FAILURE_TOPIC_ARN` | Compensation functions | Previous step's failure topic (empty for step 1) |

---
