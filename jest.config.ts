import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['lib/**/*.ts', '!lib/**/*.d.ts'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Each worker loads its own copy of aws-cdk-lib and synthesizes CloudFormation,
  // which is memory-heavy. Jest's default of (cores - 1) workers will exhaust a
  // 16 GB machine and start swapping. Cap it so runs are predictable locally and
  // in CI. Use `--runInBand` for a fully serial run on a constrained machine.
  maxWorkers: 4,
};

export default config;
