import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { test } from 'node:test';

import {
  createRedisRuntime,
  RedisRuntimeUnavailableError,
  type RedisConnectionOptions,
} from '@oms/redis';
import { createRedisLuaScriptExecutor, defineRedisLuaScript } from '@oms/redis/lua-script';

const REDIS_COUNTER_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local nextValue = 1

if current then
  nextValue = tonumber(current) + 1
end

redis.call('SET', KEYS[1], tostring(nextValue), 'PX', ARGV[1])
return nextValue
`;
const REDIS_COMPLETION_READ_SCRIPT = `return redis.call('GET', KEYS[1])`;
const REDIS_WRITTEN_COMMAND_DEADLINE_SCRIPT = `
local startedAt = redis.call('TIME')
local accumulator = tonumber(startedAt[2])
local iterations = tonumber(ARGV[1])

for index = 1, iterations do
  accumulator = (accumulator + index) % 2147483647
end

redis.call('SET', KEYS[1], 'completed', 'PX', ARGV[2])
return 'completed'
`;
const REDIS_COUNTER_TTL_MILLISECONDS = '15000';
const REDIS_WRITTEN_COMMAND_ITERATION_COUNT = '20000000';
const REDIS_WRITTEN_COMMAND_TTL_MILLISECONDS = '15000';
const CONCURRENT_INCREMENT_COUNT = 64;
const SAFE_UNAVAILABLE_MESSAGE = 'Redis runtime is unavailable';

function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;

  while (!existsSync(resolve(currentDirectory, 'pnpm-workspace.yaml'))) {
    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error('Redis integration environment is unavailable');
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

const repositoryRoot = findRepositoryRoot(__dirname);

function integrationEnvironmentUnavailable(): never {
  throw new Error('Redis integration environment is unavailable');
}

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    integrationEnvironmentUnavailable();
  }

  return value;
}

function readPort(name: string): number {
  const value = readRequiredEnvironmentVariable(name);

  if (!/^\d{1,5}$/u.test(value)) {
    integrationEnvironmentUnavailable();
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    integrationEnvironmentUnavailable();
  }

  return port;
}

function decodePasswordFile(pathValue: string): string {
  const path = isAbsolute(pathValue) ? pathValue : resolve(repositoryRoot, pathValue);
  const bytes = readFileSync(path);
  let end = bytes.length;

  if (end > 0 && bytes[end - 1] === 0x0a) {
    end -= 1;

    if (end > 0 && bytes[end - 1] === 0x0d) {
      end -= 1;
    }
  }

  const passwordBytes = bytes.subarray(0, end);
  const password = passwordBytes.toString('utf8');

  if (passwordBytes.length === 0 || !Buffer.from(password, 'utf8').equals(passwordBytes)) {
    integrationEnvironmentUnavailable();
  }

  return password;
}

function readPassword(): string {
  const password = process.env['REDIS_PASSWORD'];
  const passwordFile = process.env['REDIS_PASSWORD_FILE'];

  if ((password === undefined) === (passwordFile === undefined)) {
    integrationEnvironmentUnavailable();
  }

  if (password !== undefined) {
    if (password.length === 0) {
      integrationEnvironmentUnavailable();
    }

    return password;
  }

  if (passwordFile === undefined) {
    integrationEnvironmentUnavailable();
  }

  return decodePasswordFile(passwordFile);
}

function redisOptions(overrides: Partial<RedisConnectionOptions> = {}): RedisConnectionOptions {
  if (process.env['REDIS_TLS_MODE'] !== undefined && process.env['REDIS_TLS_MODE'] !== 'disabled') {
    integrationEnvironmentUnavailable();
  }

  return {
    commandQueueLimit: 256,
    commandTimeoutMilliseconds: 500,
    connectTimeoutMilliseconds: 1_000,
    host: readRequiredEnvironmentVariable('REDIS_HOST'),
    password: readPassword(),
    port: readPort('REDIS_PORT'),
    probeTimeoutMilliseconds: 1_000,
    shutdownTimeoutMilliseconds: 1_000,
    tls: { enabled: false },
    username: readRequiredEnvironmentVariable('REDIS_USERNAME'),
    ...overrides,
  };
}

function assertSafeUnavailableError(error: unknown, secret: string): boolean {
  assert.ok(error instanceof RedisRuntimeUnavailableError);
  assert.equal(error.name, 'RedisRuntimeUnavailableError');
  assert.equal(error.message, SAFE_UNAVAILABLE_MESSAGE);
  assert.equal('cause' in error, false);
  assert.equal(String(error).includes(secret), false);
  assert.equal((error.stack ?? '').includes(secret), false);
  assert.equal(JSON.stringify(error).includes(secret), false);
  return true;
}

interface RedisProtocolBlackhole {
  readonly close: () => Promise<void>;
  readonly port: number;
}

async function createRedisProtocolBlackhole(): Promise<RedisProtocolBlackhole> {
  const acceptedSockets = new Set<Socket>();
  const server = createServer((socket): void => {
    acceptedSockets.add(socket);
    socket.once('close', (): void => {
      acceptedSockets.delete(socket);
    });
    socket.pause();
  });

  await new Promise<void>((resolveListen, rejectListen): void => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', (): void => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    server.close();
    integrationEnvironmentUnavailable();
  }

  return {
    async close(): Promise<void> {
      for (const socket of acceptedSockets) {
        socket.destroy();
      }

      await new Promise<void>((resolveClose, rejectClose): void => {
        server.close((error): void => {
          if (error !== undefined) {
            rejectClose(error);
            return;
          }

          resolveClose();
        });
      });
    },
    port: address.port,
  };
}

async function settleWithinTestDeadline<Value>(
  operation: Promise<Value>,
  timeoutMilliseconds: number,
): Promise<Value> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject): void => {
        timeout = setTimeout((): void => {
          reject(new Error('Redis integration operation exceeded its deadline'));
        }, timeoutMilliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

void test('authenticated runtime probes Redis and atomically executes a cached static script', async () => {
  const options = redisOptions();
  const runtime = createRedisRuntime(options);
  const executor = createRedisLuaScriptExecutor(runtime);
  const script = defineRedisLuaScript(REDIS_COUNTER_SCRIPT, 1, 1);
  const key = `oms:integration:redis-runtime:${randomBytes(16).toString('hex')}`;

  try {
    await runtime.connection.probe();

    // On a clean Redis instance this call proves EVALSHA -> NOSCRIPT -> EVAL
    // interoperability. A repeated local run remains valid if Redis cached it.
    assert.equal(await executor.execute(script, [key], [REDIS_COUNTER_TTL_MILLISECONDS]), 1);
    assert.equal(await executor.execute(script, [key], [REDIS_COUNTER_TTL_MILLISECONDS]), 2);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_INCREMENT_COUNT }, async (): Promise<unknown> =>
        executor.execute(script, [key], [REDIS_COUNTER_TTL_MILLISECONDS]),
      ),
    );
    const numericResults = results.map((result): number => {
      assert.equal(typeof result, 'number');
      return result as number;
    });

    assert.deepEqual(
      numericResults.toSorted((left, right): number => left - right),
      Array.from({ length: CONCURRENT_INCREMENT_COUNT }, (_, index): number => index + 3),
    );
  } finally {
    await runtime.close();
  }

  await runtime.close();
  await assert.rejects(runtime.connection.probe(), (error: unknown): boolean =>
    assertSafeUnavailableError(error, options.password),
  );
  await assert.rejects(
    executor.execute(script, [key], [REDIS_COUNTER_TTL_MILLISECONDS]),
    (error: unknown): boolean => assertSafeUnavailableError(error, options.password),
  );
});

void test('wrong credentials fail closed without exposing the credential or vendor cause', async () => {
  const options = redisOptions();
  const wrongPassword =
    options.password === 'intentionally-invalid-integration-password'
      ? 'a-different-invalid-integration-password'
      : 'intentionally-invalid-integration-password';
  const runtime = createRedisRuntime({ ...options, password: wrongPassword });

  try {
    await assert.rejects(runtime.connection.probe(), (error: unknown): boolean => {
      assertSafeUnavailableError(error, options.password);
      return assertSafeUnavailableError(error, wrongPassword);
    });
  } finally {
    await runtime.close();
  }
});

void test('a written command fails at its deadline and the same runtime reconnects after Redis completes it', async () => {
  const options = redisOptions({
    commandTimeoutMilliseconds: 25,
    connectTimeoutMilliseconds: 1_000,
    probeTimeoutMilliseconds: 1_000,
  });
  const runtime = createRedisRuntime(options);
  const executor = createRedisLuaScriptExecutor(runtime);
  const completionReader = defineRedisLuaScript(REDIS_COMPLETION_READ_SCRIPT, 1, 0);
  const delayedCompletion = defineRedisLuaScript(REDIS_WRITTEN_COMMAND_DEADLINE_SCRIPT, 1, 2);
  const key = `oms:integration:redis-deadline:${randomBytes(16).toString('hex')}`;

  try {
    await runtime.connection.probe();

    // Cache the read-only verifier before Redis is deliberately occupied.
    assert.equal(await executor.execute(completionReader, [key], []), null);

    const startedAt = performance.now();

    await assert.rejects(
      settleWithinTestDeadline(
        executor.execute(
          delayedCompletion,
          [key],
          [REDIS_WRITTEN_COMMAND_ITERATION_COUNT, REDIS_WRITTEN_COMMAND_TTL_MILLISECONDS],
        ),
        2_000,
      ),
      (error: unknown): boolean => assertSafeUnavailableError(error, options.password),
    );
    assert.ok(performance.now() - startedAt < 200);

    // Redis is single-threaded: this fresh connection cannot become ready until
    // the timed-out script has completed on the server.
    await settleWithinTestDeadline(runtime.connection.probe(), 2_000);
    assert.equal(
      await settleWithinTestDeadline(executor.execute(completionReader, [key], []), 2_000),
      'completed',
    );
  } finally {
    await runtime.close();
  }
});

void test('a silent Redis endpoint fails within the full connection-readiness bound', async () => {
  const options = redisOptions();
  const blackhole = await createRedisProtocolBlackhole();
  const runtime = createRedisRuntime({
    ...options,
    connectTimeoutMilliseconds: 250,
    host: '127.0.0.1',
    port: blackhole.port,
  });
  const startedAt = performance.now();

  try {
    await assert.rejects(
      settleWithinTestDeadline(runtime.connection.probe(), 2_000),
      (error: unknown): boolean => assertSafeUnavailableError(error, options.password),
    );
    assert.ok(performance.now() - startedAt < 2_000);
  } finally {
    await runtime.close();
    await blackhole.close();
  }
});
