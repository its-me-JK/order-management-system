import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { findRuntimeBaseDirectory, loadLocalEnvironment } from './bootstrap.configuration';

const TEST_ENVIRONMENT_KEY = 'OMS_API_BOOTSTRAP_TEST_VALUE';

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}

describe('API bootstrap configuration', (): void => {
  it('finds the workspace root from a package working directory', (): void => {
    const workspace = mkdtempSync(resolve(tmpdir(), 'oms-api-workspace-'));
    const packageDirectory = resolve(workspace, 'apps', 'api');

    try {
      mkdirSync(packageDirectory, { recursive: true });
      writeFileSync(resolve(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');

      expect(findRuntimeBaseDirectory(packageDirectory)).toBe(workspace);
    } finally {
      rmSync(workspace, { recursive: true });
    }
  });

  it('loads a local environment without overriding externally injected values', (): void => {
    const runtimeDirectory = mkdtempSync(resolve(tmpdir(), 'oms-api-environment-'));
    const previousNodeEnvironment = process.env['NODE_ENV'];
    const previousTestValue = process.env[TEST_ENVIRONMENT_KEY];

    try {
      process.env['NODE_ENV'] = 'development';
      process.env[TEST_ENVIRONMENT_KEY] = 'injected-value';
      writeFileSync(resolve(runtimeDirectory, '.env'), `${TEST_ENVIRONMENT_KEY}=file-value\n`);

      loadLocalEnvironment(runtimeDirectory);

      expect(process.env[TEST_ENVIRONMENT_KEY]).toBe('injected-value');
    } finally {
      restoreEnvironmentVariable('NODE_ENV', previousNodeEnvironment);
      restoreEnvironmentVariable(TEST_ENVIRONMENT_KEY, previousTestValue);
      rmSync(runtimeDirectory, { recursive: true });
    }
  });

  it('never loads a local environment in production', (): void => {
    const runtimeDirectory = mkdtempSync(resolve(tmpdir(), 'oms-api-production-'));
    const previousNodeEnvironment = process.env['NODE_ENV'];
    const previousTestValue = process.env[TEST_ENVIRONMENT_KEY];

    try {
      process.env['NODE_ENV'] = 'production';
      Reflect.deleteProperty(process.env, TEST_ENVIRONMENT_KEY);
      writeFileSync(resolve(runtimeDirectory, '.env'), `${TEST_ENVIRONMENT_KEY}=file-value\n`);

      loadLocalEnvironment(runtimeDirectory);

      expect(process.env[TEST_ENVIRONMENT_KEY]).toBeUndefined();
    } finally {
      restoreEnvironmentVariable('NODE_ENV', previousNodeEnvironment);
      restoreEnvironmentVariable(TEST_ENVIRONMENT_KEY, previousTestValue);
      rmSync(runtimeDirectory, { recursive: true });
    }
  });
});
