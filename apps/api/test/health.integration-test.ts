import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createDatabase,
  type DatabaseConnection,
  type DatabaseConnectionOptions,
} from '@oms/database';

import { configureApiApplication } from '../src/api.application';
import { ApiModule } from '../src/api.module';
import { parseBootstrapConfiguration } from '../src/bootstrap.configuration';

const HTTP_SAFETY_TIMEOUT_MILLISECONDS = 5_000;
const STALLED_PROBE_TIMEOUT_MILLISECONDS = 100;
const STALLED_PROBE_MAXIMUM_DURATION_MILLISECONDS = 1_000;

function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;

  while (!existsSync(resolve(currentDirectory, 'pnpm-workspace.yaml'))) {
    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error('Unable to locate the repository root');
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

const repositoryRoot = findRepositoryRoot(__dirname);
const localEnvironmentFile = resolve(repositoryRoot, '.env');

if (existsSync(localEnvironmentFile)) {
  loadEnvFile(localEnvironmentFile);
}

function configuredDatabaseOptions(): DatabaseConnectionOptions {
  return parseBootstrapConfiguration(process.env, repositoryRoot).database;
}

interface RunningApi {
  readonly application: INestApplication;
  readonly baseUrl: string;
}

async function startApi(database: DatabaseConnection): Promise<RunningApi> {
  const application = await NestFactory.create<NestExpressApplication>(
    ApiModule.register({
      createDatabaseConnection: (): DatabaseConnection => database,
      observability: {
        deploymentEnvironment: 'test',
        level: 'silent',
      },
    }),
    { bodyParser: false, logger: false },
  );

  configureApiApplication(application);
  await application.listen(0, '127.0.0.1');

  return {
    application,
    baseUrl: await application.getUrl(),
  };
}

async function requestHealth(
  baseUrl: string,
  path: string,
): Promise<{
  readonly body: unknown;
  readonly response: Response;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(HTTP_SAFETY_TIMEOUT_MILLISECONDS),
  });

  return {
    body: (await response.json()) as unknown,
    response,
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo | null;

  if (address === null) {
    throw new Error('Stalled TCP test server did not bind');
  }

  return address.port;
}

async function closeServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }

  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolveClose, reject): void => {
    server.close((error): void => {
      if (error === undefined) {
        resolveClose();
      } else {
        reject(error);
      }
    });
  });
}

void test('API readiness executes a real bounded query through the database facade', async () => {
  const database = createDatabase(configuredDatabaseOptions());
  let runningApi: RunningApi | undefined;

  try {
    runningApi = await startApi(database);
    const liveness = await requestHealth(runningApi.baseUrl, '/health/live');
    const readiness = await requestHealth(runningApi.baseUrl, '/health/ready');

    assert.equal(liveness.response.status, 200);
    assert.deepEqual(liveness.body, {
      status: 'ok',
      info: {},
      error: {},
      details: {},
    });
    assert.equal(readiness.response.status, 200);
    assert.deepEqual(readiness.body, {
      status: 'ok',
      info: { database: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' } },
    });
  } finally {
    if (runningApi === undefined) {
      await database.close();
    } else {
      await runningApi.application.close();
    }
  }

  await assert.rejects(database.probe(), /Database connection is closed/u);
});

void test('a stalled MySQL handshake becomes a sanitized bounded readiness failure', async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket): void => {
    sockets.add(socket);
    socket.once('close', (): void => {
      sockets.delete(socket);
    });
  });
  const port = await listen(server);
  const database = createDatabase({
    ...configuredDatabaseOptions(),
    acquireTimeoutMilliseconds: 1_000,
    connectTimeoutMilliseconds: 500,
    host: '127.0.0.1',
    port,
    probeTimeoutMilliseconds: STALLED_PROBE_TIMEOUT_MILLISECONDS,
    tls: { enabled: false },
  });
  let runningApi: RunningApi | undefined;

  try {
    runningApi = await startApi(database);
    const startedAt = performance.now();
    const readiness = await requestHealth(runningApi.baseUrl, '/health/ready');
    const durationMilliseconds = performance.now() - startedAt;

    assert.equal(readiness.response.status, 503);
    assert.deepEqual(readiness.body, {
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    });
    assert.ok(
      durationMilliseconds < STALLED_PROBE_MAXIMUM_DURATION_MILLISECONDS,
      `Readiness exceeded its upper bound: ${String(durationMilliseconds)}ms`,
    );
  } finally {
    await closeServer(server, sockets);

    if (runningApi === undefined) {
      await database.close();
    } else {
      await runningApi.application.close();
    }
  }
});
