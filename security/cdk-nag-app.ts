// cdk-nag harness for this construct library.
//
// cdk-nag inspects the CloudFormation that a CDK app synthesizes. `bin/app.ts` is
// deliberately an empty stub, so running cdk-nag against it produces no templates
// and therefore no findings — a clean report that proves nothing. This app exists
// so there is always something real to scan: it declares every pattern exported
// from `lib/` once, in its own stack, and applies the AwsSolutions rule pack.
//
// Originally written by AWS Security during the pre-publication review; kept in the
// repo so the run is reproducible rather than a one-off.
//
// Usage:
//   npm run security:nag          # synth + check, writes reports to nag.out/
//   npm run security:nag:summary  # the same, then aggregate findings by rule
//
// Findings land in nag.out/AwsSolutions-<Stack>-NagReport.csv, one per pattern.
//
// Constructs are instantiated with their DEFAULT props wherever possible. That is
// the point: the report reflects what a consumer gets out of the box, not what a
// carefully hardened configuration could achieve.
//
// Resources prefixed 'Shared' are prerequisites a caller must supply (VPC, secret,
// security group, event bus). They are not part of the library, so their findings
// are excluded from the summary.
import 'source-map-support/register';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { AwsSolutionsChecks } from 'cdk-nag';
import * as lib from '../lib';

const app = new cdk.App();
const code = lambda.Code.fromInline('exports.handler = async () => ({});');
const h = 'index.handler';

// AppSync needs a schema file on disk.
const schemaPath = path.join(os.tmpdir(), 'eip-nag-schema.graphql');
fs.writeFileSync(schemaPath, 'type Query { getItem(id: ID!): Item }\ntype Item { id: ID! name: String }\n');

type Builder = (stack: cdk.Stack) => void;

function shared(stack: cdk.Stack) {
  const vpc = new ec2.Vpc(stack, 'SharedVpc', { maxAzs: 2, natGateways: 1 });
  const sg = new ec2.SecurityGroup(stack, 'SharedSg', { vpc });
  const secret = new secretsmanager.Secret(stack, 'SharedSecret', {
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ username: 'admin' }),
      generateStringKey: 'password',
      excludePunctuation: true,
    },
  });
  return { vpc, sg, secret };
}

const builders: Record<string, Builder> = {
  PublishSubscribeSns: (s) =>
    void new lib.PublishSubscribeSns(s, 'C', { subscriberQueues: 2, subscriberLambdas: [{ handler: h, code }] }),
  PublishSubscribeMq: (s) => {
    const { vpc, sg, secret } = shared(s);
    new lib.PublishSubscribeMq(s, 'C', {
      vpc, brokerSecret: secret, brokerSecurityGroup: sg,
      subscribers: [{ name: 'A', destination: 'a.events', handler: h, code }],
    });
  },
  ContentBasedRouter: (s) =>
    void new lib.ContentBasedRouter(s, 'C', {
      rules: [
        { eventPattern: { source: ['a'] }, target: 'lambda', lambdaConfig: { handler: h, code } },
        { eventPattern: { source: ['b'] }, target: 'sqs' },
        { eventPattern: { source: ['c'] }, target: 'sns' },
      ],
    }),
  RequestReply: (s) => void new lib.RequestReply(s, 'C', { consumerHandler: h, consumerCode: code }),
  RequestReplyMq: (s) => {
    const { vpc, sg, secret } = shared(s);
    new lib.RequestReplyMq(s, 'C', { vpc, brokerSecret: secret, brokerSecurityGroup: sg });
  },
  RequestReplyLargePayload: (s) =>
    void new lib.RequestReplyLargePayload(s, 'C', { consumerHandler: h, consumerCode: code }),
  ScatterGather: (s) =>
    void new lib.ScatterGather(s, 'C', {
      recipientCount: 2, recipientHandler: h, recipientCode: code, aggregatorHandler: h, aggregatorCode: code,
    }),
  Aggregator: (s) =>
    void new lib.Aggregator(s, 'C', { collectorHandler: h, collectorCode: code, processorHandler: h, processorCode: code }),
  Splitter: (s) => void new lib.Splitter(s, 'C', { splitterHandler: h, splitterCode: code, outputQueueCount: 2 }),
  Resequencer: (s) =>
    void new lib.Resequencer(s, 'C', { collectorHandler: h, collectorCode: code, dispatcherHandler: h, dispatcherCode: code }),
  ContentEnricher: (s) =>
    void new lib.ContentEnricher(s, 'C', { enricherHandler: h, enricherCode: code, createApi: true }),
  ApiCompositionAppSync: (s) =>
    void new lib.ApiCompositionAppSync(s, 'C', {
      schemaPath,
      resolvers: [
        { typeName: 'Query', fieldName: 'getItem', kind: 'dynamodb' },
      ],
    }),
  ApiCompositionApollo: (s) => {
    const { vpc } = shared(s);
    new lib.ApiCompositionApollo(s, 'C', { vpc, containerImage: ecs.ContainerImage.fromRegistry('apollo/test:latest') });
  },
  EventStreaming: (s) => void new lib.EventStreaming(s, 'C', { consumerHandler: h, consumerCode: code }),
  SagaChoreography: (s) =>
    void new lib.SagaChoreography(s, 'C', {
      steps: [
        { name: 'Reserve', handler: h, code, compensationHandler: h, compensationCode: code },
        { name: 'Charge', handler: h, code, compensationHandler: h, compensationCode: code },
      ],
    }),
  SagaOrchestration: (s) =>
    void new lib.SagaOrchestration(s, 'C', {
      steps: [
        { name: 'Reserve', handler: h, code, compensationHandler: h, compensationCode: code },
        { name: 'Charge', handler: h, code },
      ],
    }),
  MessageReplayArchive: (s) =>
    void new lib.MessageReplayArchive(s, 'C', { archiveHandler: h, archiveCode: code, replayHandler: h, replayCode: code }),
  ClaimCheck: (s) =>
    void new lib.ClaimCheck(s, 'C', { checkinHandler: h, checkinCode: code, checkoutHandler: h, checkoutCode: code }),
  IdempotentReceiver: (s) => void new lib.IdempotentReceiver(s, 'C', { handler: h, code }),
  WireTap: (s) => {
    const bus = new events.EventBus(s, 'SharedBus');
    new lib.WireTap(s, 'C', { eventBus: bus });
  },
  MessageFilter: (s) => {
    const bus = new events.EventBus(s, 'SharedBus');
    new lib.MessageFilter(s, 'C', { eventBus: bus, eventPattern: { source: ['a'] }, target: 'sqs' });
  },
  Outbox: (s) => void new lib.Outbox(s, 'C', {}),
  MessageTranslator: (s) => void new lib.MessageTranslator(s, 'C', { translatorHandler: h, translatorCode: code }),
  FileTransfer: (s) => void new lib.FileTransfer(s, 'C', { ingestionHandler: h, ingestionCode: code }),
  Throttling: (s) =>
    void new lib.Throttling(s, 'C', { workerHandler: h, workerCode: code, workerReservedConcurrency: 5, createApi: true }),
  CircuitBreaker: (s) => void new lib.CircuitBreaker(s, 'C', { handler: h, code }),
  RetryWithBackoff: (s) => void new lib.RetryWithBackoff(s, 'C', { workerHandler: h, workerCode: code }),
  ProcessManager: (s) =>
    void new lib.ProcessManager(s, 'C', { steps: [{ name: 'Validate', handler: h, code, maxRetries: 2 }, { name: 'Persist', handler: h, code }] }),
  RoutingSlip: (s) =>
    void new lib.RoutingSlip(s, 'C', { steps: [{ name: 'validate', handler: h, code }, { name: 'enrich', handler: h, code }] }),
};

// Guards against a pattern being added to lib/ but not to this harness, which would
// otherwise silently shrink the scan.
const EXPECTED_PATTERNS = 29;
const names = Object.keys(builders);
if (names.length !== EXPECTED_PATTERNS) {
  throw new Error(
    `Expected ${EXPECTED_PATTERNS} constructs, harness declares ${names.length}. ` +
      'Add the missing pattern here so cdk-nag covers it.',
  );
}

for (const name of names) {
  const stack = new cdk.Stack(app, name, { env: { account: '111111111111', region: 'us-east-1' } });
  builders[name](stack);
}

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true, reports: true, logIgnores: false }));
app.synth();
