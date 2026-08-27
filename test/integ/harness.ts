import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Hosted integration test harness.
 *
 * Each test writes a small CDK app to a temp directory, deploys it via the CDK CLI,
 * runs an assertion phase using the AWS SDK, then destroys the stack.
 *
 * Tests are skipped unless RUN_HOSTED_INTEG=1 is set, to prevent accidental cost.
 */

export function shouldRunHosted(): boolean {
  return process.env.RUN_HOSTED_INTEG === '1';
}

export function describeHosted(name: string, fn: () => void): void {
  if (shouldRunHosted()) {
    describe(name, fn);
  } else {
    describe.skip(name, fn);
  }
}

export interface DeployedStack {
  stackName: string;
  outputs: Record<string, string>;
  destroy: () => void;
}

/**
 * Deploys a CDK app from inline TypeScript code. Returns stack outputs and a destroy hook.
 *
 * @param stackId      — used to name the stack and the temp directory.
 * @param appSource    — TypeScript source. Must export a default class extending cdk.Stack.
 * @param libImportPath— absolute path to the integration repo's lib/ directory.
 */
export function deployStack(
  stackId: string,
  appSource: string,
  libImportPath: string,
): DeployedStack {
  if (!process.env.AWS_REGION) throw new Error('AWS_REGION must be set');
  if (!process.env.INTEG_TEST_ACCOUNT) throw new Error('INTEG_TEST_ACCOUNT must be set');

  const stackName = `EipIntegTest-${stackId}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `eip-integ-${stackId}-`));

  // Write app.ts that imports from the lib via absolute path.
  const appTs = `
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
${appSource.replace('@@LIB_PATH@@', libImportPath)}

const app = new cdk.App();
new IntegStack(app, '${stackName}', {
  env: {
    account: '${process.env.INTEG_TEST_ACCOUNT}',
    region: '${process.env.AWS_REGION}',
  },
});
app.synth();
`;
  fs.writeFileSync(path.join(dir, 'app.ts'), appTs);
  fs.writeFileSync(
    path.join(dir, 'cdk.json'),
    JSON.stringify({ app: 'npx ts-node app.ts' }, null, 2),
  );

  // Deploy. --require-approval never; capture outputs to JSON.
  const outputsFile = path.join(dir, 'outputs.json');
  execSync(
    `cd "${dir}" && npx cdk deploy --require-approval never --outputs-file outputs.json --app "npx ts-node app.ts"`,
    { stdio: 'inherit', timeout: 600_000 },
  );

  let outputs: Record<string, string> = {};
  if (fs.existsSync(outputsFile)) {
    const raw = JSON.parse(fs.readFileSync(outputsFile, 'utf-8'));
    outputs = raw[stackName] ?? {};
  }

  return {
    stackName,
    outputs,
    destroy: () => {
      try {
        execSync(
          `cd "${dir}" && npx cdk destroy ${stackName} --force --app "npx ts-node app.ts"`,
          { stdio: 'inherit', timeout: 600_000 },
        );
      } catch (e) {
        console.warn(`destroy failed for ${stackName}; clean up manually if necessary`, e);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export async function poll<T>(
  fn: () => Promise<T | null>,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const interval = options.intervalMs ?? 2_000;
  const timeout = options.timeoutMs ?? 60_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v !== null && v !== undefined) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`poll timed out after ${timeout}ms`);
}
