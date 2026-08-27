import * as path from 'path';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SFNClient, ListExecutionsCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { describeHosted, deployStack, poll } from './harness';

describeHosted('SagaOrchestration (hosted)', () => {
  let deployed: ReturnType<typeof deployStack> | null = null;

  afterAll(() => {
    if (deployed) deployed.destroy();
  });

  test('happy path reaches Succeeded', async () => {
    const libPath = path.resolve(__dirname, '../../lib');
    deployed = deployStack(
      'saga-orch',
      `
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SagaOrchestration } from '@@LIB_PATH@@';

class IntegStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const ok = lambda.Code.fromInline("exports.handler = async (e) => ({ ok: true, step: process.env.STEP_NAME });");
    const saga = new SagaOrchestration(this, 'Saga', {
      steps: [
        { name: 'A', handler: 'index.handler', code: ok },
        { name: 'B', handler: 'index.handler', code: ok },
        { name: 'C', handler: 'index.handler', code: ok },
      ],
    });
    new cdk.CfnOutput(this, 'StateQueueUrl', { value: saga.stateQueue.queueUrl });
    new cdk.CfnOutput(this, 'StateMachineArn', { value: saga.stateMachine.stateMachineArn });
  }
}
`,
      libPath,
    );

    const sqs = new SQSClient({ region: process.env.AWS_REGION });
    const sfn = new SFNClient({ region: process.env.AWS_REGION });
    const startedAt = new Date(Date.now() - 60_000);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: deployed.outputs.StateQueueUrl,
        MessageBody: JSON.stringify({ orderId: `o-${Date.now()}` }),
      }),
    );

    const succeeded = await poll(
      async () => {
        const list = await sfn.send(
          new ListExecutionsCommand({
            stateMachineArn: deployed!.outputs.StateMachineArn,
            statusFilter: 'SUCCEEDED',
            maxResults: 5,
          }),
        );
        const recent = (list.executions ?? []).find(
          (e) => e.startDate && e.startDate.getTime() > startedAt.getTime(),
        );
        if (!recent) return null;
        const desc = await sfn.send(new DescribeExecutionCommand({ executionArn: recent.executionArn }));
        if (desc.status !== 'SUCCEEDED') return null;
        return true;
      },
      { timeoutMs: 180_000, intervalMs: 5_000 },
    );

    expect(succeeded).toBe(true);
  }, 600_000);
});
