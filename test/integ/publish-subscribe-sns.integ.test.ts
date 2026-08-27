import * as path from 'path';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { describeHosted, deployStack, poll } from './harness';

describeHosted('PublishSubscribeSns (hosted)', () => {
  let deployed: ReturnType<typeof deployStack> | null = null;

  afterAll(() => {
    if (deployed) deployed.destroy();
  });

  test('one publish reaches all subscriber queues', async () => {
    const libPath = path.resolve(__dirname, '../../lib');
    deployed = deployStack(
      'pubsub-sns',
      `
import { PublishSubscribeSns } from '@@LIB_PATH@@';

class IntegStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const ps = new PublishSubscribeSns(this, 'Ps', { subscriberQueues: 3 });
    new cdk.CfnOutput(this, 'TopicArn', { value: ps.topic.topicArn });
    new cdk.CfnOutput(this, 'Q0', { value: ps.queues[0].queueUrl });
    new cdk.CfnOutput(this, 'Q1', { value: ps.queues[1].queueUrl });
    new cdk.CfnOutput(this, 'Q2', { value: ps.queues[2].queueUrl });
  }
}
`,
      libPath,
    );

    const sns = new SNSClient({ region: process.env.AWS_REGION });
    const sqs = new SQSClient({ region: process.env.AWS_REGION });
    const marker = `marker-${Date.now()}`;

    await sns.send(
      new PublishCommand({
        TopicArn: deployed.outputs.TopicArn,
        Message: JSON.stringify({ marker }),
      }),
    );

    const queueUrls = [deployed.outputs.Q0, deployed.outputs.Q1, deployed.outputs.Q2];
    for (const url of queueUrls) {
      const received = await poll(
        async () => {
          const resp = await sqs.send(
            new ReceiveMessageCommand({
              QueueUrl: url,
              MaxNumberOfMessages: 1,
              WaitTimeSeconds: 5,
            }),
          );
          const msg = resp.Messages?.[0];
          if (!msg?.Body) return null;
          if (!msg.Body.includes(marker)) return null;
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: url,
              ReceiptHandle: msg.ReceiptHandle!,
            }),
          );
          return true;
        },
        { timeoutMs: 60_000 },
      );
      expect(received).toBe(true);
    }
  }, 600_000);
});
