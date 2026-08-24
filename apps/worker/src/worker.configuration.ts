import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  parseDatabaseRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
  type ResolvedDatabaseRuntimeConfiguration,
  type RuntimeEnvironment,
} from '@oms/configuration';
import type { RabbitMqMessagingOptions } from '@oms/messaging';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const LOCAL_ENVIRONMENT_FILE = '.env';

export interface WorkerConfiguration {
  readonly database: ResolvedDatabaseRuntimeConfiguration;
  readonly messaging: RabbitMqMessagingOptions;
  readonly outbox: Readonly<{
    batchSize: number;
    initialBackoffMilliseconds: number;
    maximumAttempts: number;
    maximumBackoffMilliseconds: number;
    pollIntervalMilliseconds: number;
  }>;
}

export class InvalidWorkerConfigurationError extends Error {
  public constructor() {
    super('Invalid worker configuration');
    this.name = 'InvalidWorkerConfigurationError';
  }
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? String(fallback);

  if (!/^(?:0|[1-9]\d*)$/u.test(candidate)) {
    throw new InvalidWorkerConfigurationError();
  }

  const parsed = Number(candidate);

  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidWorkerConfigurationError();
  }

  return parsed;
}

function runtimeEnvironment(value: string | undefined): RuntimeEnvironment {
  const candidate = value ?? 'development';

  if (candidate === 'development' || candidate === 'test' || candidate === 'production') {
    return candidate;
  }

  throw new InvalidWorkerConfigurationError();
}

function oneTerminalNewline(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function messagingUrl(
  environment: Readonly<Record<string, string | undefined>>,
  baseDirectory: string,
): string {
  let candidate = environment['RABBITMQ_URL']?.trim();

  if (candidate === undefined || candidate === '') {
    const directPassword = environment['RABBITMQ_PASSWORD'];
    const passwordFile = environment['RABBITMQ_PASSWORD_FILE'];

    if ((directPassword === undefined) === (passwordFile === undefined)) {
      throw new InvalidWorkerConfigurationError();
    }

    let password: string;

    if (directPassword !== undefined) {
      password = directPassword;
    } else {
      if (passwordFile === undefined) {
        throw new InvalidWorkerConfigurationError();
      }

      password = oneTerminalNewline(readFileSync(resolve(baseDirectory, passwordFile), 'utf8'));
    }

    if (password === '') {
      throw new InvalidWorkerConfigurationError();
    }

    const url = new URL('amqp://localhost');
    url.hostname = environment['RABBITMQ_HOST']?.trim() || '127.0.0.1';
    url.port = environment['RABBITMQ_PORT']?.trim() || '5672';
    url.username = environment['RABBITMQ_USERNAME']?.trim() || 'oms_app';
    url.password = password;
    url.pathname = `/${environment['RABBITMQ_VHOST']?.trim() || 'oms'}`;
    candidate = url.toString();
  }

  if (candidate.length > 2_048) {
    throw new InvalidWorkerConfigurationError();
  }

  try {
    const url = new URL(candidate);

    if ((url.protocol !== 'amqp:' && url.protocol !== 'amqps:') || url.hostname === '') {
      throw new InvalidWorkerConfigurationError();
    }
  } catch {
    throw new InvalidWorkerConfigurationError();
  }

  return candidate;
}

export function findWorkerBaseDirectory(startDirectory: string): string {
  const fallback = resolve(startDirectory);
  let current = fallback;

  while (!existsSync(resolve(current, WORKSPACE_MARKER))) {
    const parent = dirname(current);

    if (parent === current) {
      return fallback;
    }

    current = parent;
  }

  return current;
}

export function loadWorkerEnvironment(baseDirectory: string): void {
  if (process.env['NODE_ENV'] === 'production') {
    return;
  }

  const path = resolve(baseDirectory, LOCAL_ENVIRONMENT_FILE);

  if (existsSync(path)) {
    loadEnvFile(path);
  }
}

export function parseWorkerConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  baseDirectory: string,
): WorkerConfiguration {
  try {
    const runtime = runtimeEnvironment(environment['NODE_ENV']);
    const unresolvedDatabase = parseDatabaseRuntimeConfiguration(environment, runtime);
    const database = resolveDatabaseRuntimeConfiguration(unresolvedDatabase, {
      baseDirectory,
      readFile: (path): string => readFileSync(path, 'utf8'),
    });
    const initialBackoffMilliseconds = boundedInteger(
      environment['OUTBOX_INITIAL_BACKOFF_MS'],
      1_000,
      100,
      60_000,
    );
    const maximumBackoffMilliseconds = boundedInteger(
      environment['OUTBOX_MAX_BACKOFF_MS'],
      60_000,
      initialBackoffMilliseconds,
      3_600_000,
    );

    return Object.freeze({
      database,
      messaging: Object.freeze({
        connectionTimeoutMilliseconds: boundedInteger(
          environment['RABBITMQ_CONNECT_TIMEOUT_MS'],
          5_000,
          100,
          60_000,
        ),
        prefetch: boundedInteger(environment['RABBITMQ_PREFETCH'], 10, 1, 1_000),
        url: messagingUrl(environment, baseDirectory),
      }),
      outbox: Object.freeze({
        batchSize: boundedInteger(environment['OUTBOX_BATCH_SIZE'], 25, 1, 100),
        initialBackoffMilliseconds,
        maximumAttempts: boundedInteger(environment['OUTBOX_MAX_ATTEMPTS'], 10, 1, 100),
        maximumBackoffMilliseconds,
        pollIntervalMilliseconds: boundedInteger(
          environment['OUTBOX_POLL_INTERVAL_MS'],
          500,
          100,
          60_000,
        ),
      }),
    });
  } catch {
    throw new InvalidWorkerConfigurationError();
  }
}
