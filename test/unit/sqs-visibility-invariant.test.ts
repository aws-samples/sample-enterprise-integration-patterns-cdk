import { Duration, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lib from '../../lib';
import { SQS_VISIBILITY_MULTIPLIER, queueVisibilityFor } from '../../lib/types';
import { makeStack, templateOf } from './helpers';

/**
 * Lambda rejects an SQS event source mapping whose function timeout exceeds the
 * queue's visibility timeout. It does this at CreateEventSourceMapping time, so
 * `cdk synth` and every per-construct unit test pass and the failure only shows
 * up at `cdk deploy`. SQS defaults visibility to 30 s, which happens to equal
 * DEFAULT_LAMBDA_TIMEOUT, so the defaults work by coincidence and the first
 * caller to raise `lambdaTimeout` used to get an opaque deploy error.
 *
 * This test builds every SQS-fed construct with a deliberately long timeout and
 * walks the synthesized template: for each AWS::Lambda::EventSourceMapping whose
 * source is an SQS queue, it resolves the queue and the function and asserts the
 * invariant on the actual CloudFormation. Adding a new SQS-fed pattern without
 * wiring queueVisibilityFor() fails here rather than in a consumer's account.
 *
 * https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html
 */

const RAISED = Duration.minutes(2); // > the 30 s SQS default, so the bug would surface
const code = lambda.Code.fromInline('exports.handler = async () => ({});');
const h = 'index.handler';

type Builder = (stack: Stack, timeout: Duration) => void;

// Every construct that wires an SqsEventSource. RetryWithBackoff is covered
// separately below because its visibility timeout is caller-controlled.
const sqsFed: Record<string, Builder> = {
  Aggregator: (s, t) =>
    void new lib.Aggregator(s, 'C', {
      collectorHandler: h, collectorCode: code, processorHandler: h, processorCode: code, lambdaTimeout: t,
    }),
  CircuitBreaker: (s, t) => void new lib.CircuitBreaker(s, 'C', { handler: h, code, lambdaTimeout: t }),
  ClaimCheck: (s, t) =>
    void new lib.ClaimCheck(s, 'C', {
      checkinHandler: h, checkinCode: code, checkoutHandler: h, checkoutCode: code, lambdaTimeout: t,
    }),
  ContentEnricher: (s, t) =>
    void new lib.ContentEnricher(s, 'C', { enricherHandler: h, enricherCode: code, lambdaTimeout: t }),
  IdempotentReceiver: (s, t) => void new lib.IdempotentReceiver(s, 'C', { handler: h, code, lambdaTimeout: t }),
  MessageReplayArchive: (s, t) =>
    void new lib.MessageReplayArchive(s, 'C', {
      archiveHandler: h, archiveCode: code, replayHandler: h, replayCode: code, lambdaTimeout: t,
    }),
  MessageTranslator: (s, t) =>
    void new lib.MessageTranslator(s, 'C', { translatorHandler: h, translatorCode: code, lambdaTimeout: t }),
  ProcessManager: (s, t) =>
    void new lib.ProcessManager(s, 'C', {
      steps: [{ name: 'A', handler: h, code }, { name: 'B', handler: h, code }], lambdaTimeout: t,
    }),
  RequestReply: (s, t) =>
    void new lib.RequestReply(s, 'C', { consumerHandler: h, consumerCode: code, lambdaTimeout: t }),
  RequestReplyLargePayload: (s, t) =>
    void new lib.RequestReplyLargePayload(s, 'C', { consumerHandler: h, consumerCode: code, lambdaTimeout: t }),
  Resequencer: (s, t) =>
    void new lib.Resequencer(s, 'C', {
      collectorHandler: h, collectorCode: code, dispatcherHandler: h, dispatcherCode: code, lambdaTimeout: t,
    }),
  RoutingSlip: (s, t) =>
    void new lib.RoutingSlip(s, 'C', {
      steps: [{ name: 'a', handler: h, code }, { name: 'b', handler: h, code }], lambdaTimeout: t,
    }),
  SagaChoreography: (s, t) =>
    void new lib.SagaChoreography(s, 'C', {
      steps: [
        { name: 'Reserve', handler: h, code, compensationHandler: h, compensationCode: code },
        { name: 'Charge', handler: h, code, compensationHandler: h, compensationCode: code },
      ],
      lambdaTimeout: t,
    }),
  SagaOrchestration: (s, t) =>
    void new lib.SagaOrchestration(s, 'C', {
      steps: [
        { name: 'Reserve', handler: h, code, compensationHandler: h, compensationCode: code },
        { name: 'Charge', handler: h, code },
      ],
      lambdaTimeout: t,
    }),
  Splitter: (s, t) =>
    void new lib.Splitter(s, 'C', { splitterHandler: h, splitterCode: code, outputQueueCount: 2, lambdaTimeout: t }),
  Throttling: (s, t) =>
    void new lib.Throttling(s, 'C', {
      workerHandler: h, workerCode: code, workerReservedConcurrency: 5, lambdaTimeout: t,
    }),
};

/** Resolve a `Fn::GetAtt`/`Ref` intrinsic to the logical ID it points at. */
function logicalIdOf(intrinsic: any): string | undefined {
  if (typeof intrinsic === 'string') return undefined; // literal ARN, not ours
  if (intrinsic?.Ref) return intrinsic.Ref;
  if (intrinsic?.['Fn::GetAtt']) return intrinsic['Fn::GetAtt'][0];
  return undefined;
}

/**
 * For every SQS-backed event source mapping in the template, return
 * { mapping, functionTimeout, queueVisibility }.
 */
function sqsMappings(t: Template) {
  const mappings = t.findResources('AWS::Lambda::EventSourceMapping');
  const queues = t.findResources('AWS::SQS::Queue');
  const fns = t.findResources('AWS::Lambda::Function');
  const out: Array<{ id: string; fn: number; vis: number; queueId: string; fnId: string }> = [];

  for (const [id, m] of Object.entries(mappings)) {
    const queueId = logicalIdOf(m.Properties?.EventSourceArn);
    if (!queueId || !queues[queueId]) continue; // not an SQS source (e.g. MQ, Kinesis)
    const fnId = logicalIdOf(m.Properties?.FunctionName);
    expect(fnId && fns[fnId]).toBeTruthy();
    // SQS default when the property is omitted; Lambda default when omitted is 3 s.
    const vis = queues[queueId].Properties?.VisibilityTimeout ?? 30;
    const fn = fns[fnId!].Properties?.Timeout ?? 3;
    out.push({ id, fn, vis, queueId, fnId: fnId! });
  }
  return out;
}

describe('SQS visibility timeout >= Lambda timeout (deploy-time invariant)', () => {
  test.each(Object.keys(sqsFed))('%s with lambdaTimeout raised above the SQS default', (name) => {
    const { stack } = makeStack();
    sqsFed[name](stack, RAISED);
    const found = sqsMappings(templateOf(stack));

    // The construct must actually have an SQS-fed mapping, or this test is vacuous.
    expect(found.length).toBeGreaterThan(0);

    for (const { id, fn, vis, queueId, fnId } of found) {
      // The hard Lambda rule.
      expect({ mapping: id, queue: queueId, function: fnId, fnTimeout: fn, queueVisibility: vis })
        .toMatchObject({ fnTimeout: fn, queueVisibility: expect.any(Number) });
      expect(vis).toBeGreaterThanOrEqual(fn);
      // The library's stronger promise: the recommended multiple, not a bare pass.
      expect(vis).toBe(queueVisibilityFor(RAISED).toSeconds());
      expect(vis).toBe(RAISED.toSeconds() * SQS_VISIBILITY_MULTIPLIER);
    }
  });

  test('defaults still satisfy the invariant (regression guard for the coincidence)', () => {
    const { stack } = makeStack();
    sqsFed.RequestReply(stack, Duration.seconds(30));
    for (const { fn, vis } of sqsMappings(templateOf(stack))) {
      expect(vis).toBeGreaterThanOrEqual(fn);
    }
  });

  test('queueVisibilityFor clamps at the 12-hour SQS maximum', () => {
    // Lambda max function timeout is 15 min; 6x = 90 min, comfortably inside.
    expect(queueVisibilityFor(Duration.minutes(15)).toSeconds()).toBe(15 * 60 * 6);
    // A pathological input must never produce a value SQS rejects.
    expect(queueVisibilityFor(Duration.hours(5)).toSeconds()).toBe(12 * 3600);
  });
});

describe('RetryWithBackoff keeps caller-controlled visibility but refuses an invalid pairing', () => {
  const base = { workerHandler: h, workerCode: code };

  test('default timeout with default visibility is accepted', () => {
    const { stack } = makeStack();
    expect(() => new lib.RetryWithBackoff(stack, 'C', base)).not.toThrow();
  });

  test('lambdaTimeout above initialVisibilityTimeoutSeconds fails at synth, naming both props', () => {
    const { stack } = makeStack();
    expect(
      () =>
        new lib.RetryWithBackoff(stack, 'C', {
          ...base,
          lambdaTimeout: Duration.minutes(2),
          // default initialVisibilityTimeoutSeconds = 30
        }),
    ).toThrow(/lambdaTimeout \(120s\) exceeds initialVisibilityTimeoutSeconds \(30s\)/);
  });

  test('raising initialVisibilityTimeoutSeconds alongside lambdaTimeout is accepted', () => {
    const { stack } = makeStack();
    new lib.RetryWithBackoff(stack, 'C', {
      ...base,
      lambdaTimeout: Duration.minutes(2),
      initialVisibilityTimeoutSeconds: 720,
    });
    for (const { fn, vis } of sqsMappings(templateOf(stack))) {
      expect(vis).toBeGreaterThanOrEqual(fn);
    }
  });
});
