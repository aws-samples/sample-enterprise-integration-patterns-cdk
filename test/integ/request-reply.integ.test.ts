import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { describeHosted, deployStack, poll } from './harness';

describeHosted('RequestReply (hosted)', () => {
  let deployed: ReturnType<typeof deployStack> | null = null;

  afterAll(() => {
    if (deployed) deployed.destroy();
  });

  test('producer sends → consumer replies → producer reads correlated reply', async () => {
    const libPath = path.resolve(__dirname, '../../lib');
    deployed = deployStack(
      'request-reply',
      `
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { RequestReply } from '@@LIB_PATH@@';

class IntegStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const consumerCode = lambda.Code.fromInline(\`
      const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
      const sqs = new SQSClient({});
      exports.handler = async (event) => {
        for (const r of event.Records) {
          const body = JSON.parse(r.body);
          await sqs.send(new SendMessageCommand({
            QueueUrl: process.env.REPLY_QUEUE_URL,
            MessageBody: JSON.stringify({ correlationId: body.correlationId, status: 'OK' }),
          }));
        }
      };
    \`);
    const rr = new RequestReply(this, 'Rr', {
      consumerHandler: 'index.handler',
      consumerCode,
    });
    new cdk.CfnOutput(this, 'RequestQueueUrl', { value: rr.requestQueue.queueUrl });
    new cdk.CfnOutput(this, 'ReplyQueueUrl', { value: rr.replyQueue.queueUrl });
  }
}
`,
      libPath,
    );

    const sqs = new SQSClient({ region: process.env.AWS_REGION });
    const correlationId = `corr-${Date.now()}`;

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: deployed.outputs.RequestQueueUrl,
        MessageBody: JSON.stringify({ correlationId, payload: 'ping' }),
      }),
    );

    const reply = await poll(
      async () => {
        const resp = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: deployed!.outputs.ReplyQueueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 5,
          }),
        );
        const msg = resp.Messages?.[0];
        if (!msg?.Body) return null;
        const body = JSON.parse(msg.Body);
        if (body.correlationId !== correlationId) return null;
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: deployed!.outputs.ReplyQueueUrl,
            ReceiptHandle: msg.ReceiptHandle!,
          }),
        );
        return body;
      },
      { timeoutMs: 90_000 },
    );

    expect(reply.status).toBe('OK');
    expect(reply.correlationId).toBe(correlationId);
  }, 600_000);
});
