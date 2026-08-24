import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  parseApiRuntimeConfiguration,
  parseDatabaseRuntimeConfiguration,
  parseRedisRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
  resolveRedisRuntimeConfiguration,
  type ApiRuntimeConfiguration,
  type ResolvedDatabaseRuntimeConfiguration,
  type ResolvedRedisRuntimeConfiguration,
} from '@oms/configuration';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const LOCAL_ENVIRONMENT_FILE = '.env';

export interface ApiBootstrapConfiguration {
  readonly api: ApiRuntimeConfiguration;
  readonly database: ResolvedDatabaseRuntimeConfiguration;
  readonly redis: ResolvedRedisRuntimeConfiguration;
}

export function findRuntimeBaseDirectory(startDirectory: string): string {
  const fallbackDirectory = resolve(startDirectory);
  let currentDirectory = fallbackDirectory;

  while (!existsSync(resolve(currentDirectory, WORKSPACE_MARKER))) {
    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return fallbackDirectory;
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

export function loadLocalEnvironment(baseDirectory: string): void {
  if (process.env['NODE_ENV'] === 'production') {
    return;
  }

  const environmentFile = resolve(baseDirectory, LOCAL_ENVIRONMENT_FILE);

  if (existsSync(environmentFile)) {
    loadEnvFile(environmentFile);
  }
}

export function parseBootstrapConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  baseDirectory: string,
): ApiBootstrapConfiguration {
  const api = parseApiRuntimeConfiguration(environment);
  const unresolvedDatabase = parseDatabaseRuntimeConfiguration(environment, api.environment);
  const unresolvedRedis = parseRedisRuntimeConfiguration(environment, api.deploymentEnvironment);
  const database = resolveDatabaseRuntimeConfiguration(unresolvedDatabase, {
    baseDirectory,
    readFile: (path): string => readFileSync(path, 'utf8'),
  });
  const redis = resolveRedisRuntimeConfiguration(unresolvedRedis, {
    baseDirectory,
    readFile: (path, maximumBytes): Uint8Array => readFileSync(path).subarray(0, maximumBytes),
  });

  return Object.freeze({ api, database, redis });
}
