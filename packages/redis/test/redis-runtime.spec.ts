import { inspect } from 'node:util';

import { RedisRuntimeUnavailableError, type RedisConnectionOptions } from '../src/redis.contract';
import { createRedisRuntimeWithClientFactory } from '../src/redis-runtime';
import {
  blockEventLoop,
  deferred,
  fakeRedisClient,
  fakeRedisClientFactory,
  redisOptions,
} from './redis-client.fixture';

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected operation to throw');
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve): void => {
    setImmediate(resolve);
  });
}

function expectSafeUnavailable(error: unknown, secret?: string): void {
  expect(error).toBeInstanceOf(RedisRuntimeUnavailableError);
  expect(error).toMatchObject({
    message: 'Redis runtime is unavailable',
    name: 'RedisRuntimeUnavailableError',
  });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  if (secret !== undefined) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  }
}

describe('@oms/redis managed runtime', (): void => {
  it('is lazy and installs the mandatory error listener before one connection attempt', async (): Promise<void> => {
    const control = fakeRedisClient();
    const factory = fakeRedisClientFactory(control);
    const options = redisOptions();
    const runtime = createRedisRuntimeWithClientFactory(options, factory);

    expect(factory).not.toHaveBeenCalled();

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining(options));
    expect(control.events.slice(0, 2)).toEqual(['error-listener', 'connect']);
    expect(control.onError).toHaveBeenCalledTimes(1);
    expect(control.connect).toHaveBeenCalledTimes(1);
    expect(control.ping).toHaveBeenCalledTimes(1);

    control.emitError(new Error('provider detail must be consumed'));
  });

  it('destroys a client whose error-listener registration throws and recovers later', async (): Promise<void> => {
    const secret = 'redis-listener-registration-secret';
    const first = fakeRedisClient({
      onError: (): never => {
        throw new Error(secret);
      },
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);

    const failure = await runtime.connection.probe().catch((error: unknown): unknown => error);

    expectSafeUnavailable(failure, secret);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.onError).toHaveBeenCalledTimes(1);
    expect(first.connect).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight connect and one in-flight probe', async (): Promise<void> => {
    const connectSettlement = deferred<undefined>();
    const pingSettlement = deferred<unknown>();
    const control = fakeRedisClient({
      connect: (): Promise<void> => connectSettlement.promise,
      ping: (): Promise<unknown> => pingSettlement.promise,
    });
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions(),
      fakeRedisClientFactory(control),
    );

    const first = runtime.connection.probe();
    const second = runtime.connection.probe();

    expect(first).toBe(second);
    await nextEventLoopTurn();
    expect(control.connect).toHaveBeenCalledTimes(1);
    expect(control.ping).not.toHaveBeenCalled();

    control.setOpen(true);
    control.setReady(true);
    connectSettlement.resolve(undefined);
    await nextEventLoopTurn();
    expect(control.ping).toHaveBeenCalledTimes(1);

    pingSettlement.resolve('PONG');
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('requires the exact PONG response and recovers later with a fresh client', async (): Promise<void> => {
    const first = fakeRedisClient({ ping: (): Promise<unknown> => Promise.resolve('pong') });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);

    const failure = await runtime.connection.probe().catch((error: unknown): unknown => error);
    expectSafeUnavailable(failure);
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('discards a connected client whose existing readiness getter becomes poisoned', async (): Promise<void> => {
    const secret = 'redis-existing-readiness-secret';
    const first = fakeRedisClient();
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    first.setReadyReadFailure(new Error(secret));
    const failure = await runtime.connection.probe().catch((error: unknown): unknown => error);

    expectSafeUnavailable(failure, secret);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.connect).toHaveBeenCalledTimes(1);
    expect(first.ping).toHaveBeenCalledTimes(1);
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('discards a client when its post-connect readiness getter throws', async (): Promise<void> => {
    const secret = 'redis-post-connect-readiness-secret';
    const first = fakeRedisClient();
    first.setReadyReadFailure(new Error(secret));
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);

    const failure = await runtime.connection.probe().catch((error: unknown): unknown => error);

    expectSafeUnavailable(failure, secret);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.connect).toHaveBeenCalledTimes(1);
    expect(first.ping).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('turns a failed connection into a safe error and never retries within that probe', async (): Promise<void> => {
    const secret = 'redis-provider-connection-secret';
    const first = fakeRedisClient({
      connect: (): Promise<void> => Promise.reject(new Error(secret)),
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);

    const failure = await runtime.connection.probe().catch((error: unknown): unknown => error);

    expectSafeUnavailable(failure, secret);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.connect).toHaveBeenCalledTimes(1);
    expect(first.ping).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('bounds the entire readiness handshake when connect never settles', async (): Promise<void> => {
    const first = fakeRedisClient({
      connect: (): Promise<void> => new Promise((): void => undefined),
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ connectTimeoutMilliseconds: 100 }),
      factory,
    );

    await expect(runtime.connection.probe()).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.connect).toHaveBeenCalledTimes(1);
    expect(first.ping).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps a timed-out client quarantined when its connect resolves late', async (): Promise<void> => {
    const connectSettlement = deferred<undefined>();
    const first = fakeRedisClient({ connect: (): Promise<void> => connectSettlement.promise });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ connectTimeoutMilliseconds: 100 }),
      factory,
    );

    const failure = await runtime.connection.probe().catch((error: unknown): unknown => error);
    expectSafeUnavailable(failure);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    first.setOpen(true);
    first.setReady(true);
    connectSettlement.resolve(undefined);
    await nextEventLoopTurn();

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
    expect(first.ping).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects connect fulfillment after monotonic expiry before timer delivery', async (): Promise<void> => {
    const first = fakeRedisClient();
    first.connect.mockImplementation((): Promise<void> => {
      blockEventLoop(125);
      first.setOpen(true);
      first.setReady(true);
      return Promise.resolve();
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ connectTimeoutMilliseconds: 100 }),
      factory,
    );

    await expect(runtime.connection.probe()).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(first.connect).toHaveBeenCalledTimes(1);
    expect(first.ping).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('invalidates an ambiguous probe failure before a later request reconnects', async (): Promise<void> => {
    const first = fakeRedisClient({
      ping: (): Promise<unknown> => Promise.reject(new Error('socket disconnected')),
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);

    await expect(runtime.connection.probe()).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('enforces the probe watchdog when the provider ignores AbortSignal', async (): Promise<void> => {
    const pingSettlement = deferred<unknown>();
    const first = fakeRedisClient({
      ping: (): Promise<unknown> => pingSettlement.promise,
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ probeTimeoutMilliseconds: 25 }),
      factory,
    );

    await expect(runtime.connection.probe()).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(first.ping).toHaveBeenCalledTimes(1);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    pingSettlement.resolve('late-provider-pong');
    await nextEventLoopTurn();
    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects a late PONG after monotonic expiry before timer delivery', async (): Promise<void> => {
    const first = fakeRedisClient({
      ping: (): Promise<unknown> => {
        blockEventLoop(40);
        return Promise.resolve('PONG');
      },
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ probeTimeoutMilliseconds: 25 }),
      factory,
    );

    await expect(runtime.connection.probe()).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(first.ping).toHaveBeenCalledTimes(1);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('closes without allocating a client and rejects all later work', async (): Promise<void> => {
    const control = fakeRedisClient();
    const factory = fakeRedisClientFactory(control);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);

    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(firstClose).toBe(secondClose);
    await expect(firstClose).resolves.toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    await expect(runtime.connection.probe()).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
  });

  it('waits for tracked work before destroying the client', async (): Promise<void> => {
    const pingSettlement = deferred<unknown>();
    const control = fakeRedisClient({ ping: (): Promise<unknown> => pingSettlement.promise });
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions(),
      fakeRedisClientFactory(control),
    );
    const probe = runtime.connection.probe();

    await nextEventLoopTurn();
    expect(control.ping).toHaveBeenCalledTimes(1);
    const close = runtime.close();

    expect(control.destroy).not.toHaveBeenCalled();
    pingSettlement.resolve('PONG');

    await expect(Promise.all([probe, close])).resolves.toEqual([undefined, undefined]);
    expect(control.destroy).toHaveBeenCalledTimes(1);
  });

  it('handles close racing an admitted connection without pinging or leaking the client', async (): Promise<void> => {
    const connectSettlement = deferred<undefined>();
    const control = fakeRedisClient({ connect: (): Promise<void> => connectSettlement.promise });
    const factory = fakeRedisClientFactory(control);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);
    const probe = runtime.connection.probe();

    await nextEventLoopTurn();
    expect(control.connect).toHaveBeenCalledTimes(1);
    const close = runtime.close();
    expect(control.destroy).not.toHaveBeenCalled();

    control.setOpen(true);
    control.setReady(true);
    connectSettlement.resolve(undefined);

    await expect(probe).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    await expect(close).resolves.toBeUndefined();
    expect(control.ping).not.toHaveBeenCalled();
    expect(control.destroy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    await expect(runtime.connection.probe()).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
  });

  it('bounds shutdown and force-destroys a client with unsettled work', async (): Promise<void> => {
    const pendingPing = deferred<unknown>();
    const control = fakeRedisClient({ ping: (): Promise<unknown> => pendingPing.promise });
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ shutdownTimeoutMilliseconds: 100 }),
      fakeRedisClientFactory(control),
    );
    void runtime.connection.probe().catch((): void => undefined);

    await nextEventLoopTurn();
    expect(control.ping).toHaveBeenCalledTimes(1);
    const startedAt = Date.now();
    await expect(runtime.close()).resolves.toBeUndefined();

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(75);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(control.destroy).toHaveBeenCalledTimes(1);
    pendingPing.reject(new Error('late ignored failure'));
  });

  it('freezes and redacts runtime capabilities without retaining public configuration', (): void => {
    const secret = 'redis-runtime-redaction-secret';
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ password: secret }),
      fakeRedisClientFactory(fakeRedisClient()),
    );

    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.connection)).toBe(true);
    expect(Object.keys(runtime)).toEqual([]);
    expect((runtime as unknown as { toString(): string }).toString()).toBe('[REDACTED]');
    expect(JSON.stringify(runtime)).toBe('"[REDACTED]"');
    expect(inspect(runtime)).toBe('[REDACTED]');
    expect(inspect(runtime.connection)).toBe('[REDACTED]');
    expect(inspect(runtime)).not.toContain(secret);
  });

  it.each([
    ['connect timeout below minimum', { connectTimeoutMilliseconds: 99 }],
    ['connect timeout above maximum', { connectTimeoutMilliseconds: 5_001 }],
    ['command timeout below minimum', { commandTimeoutMilliseconds: 24 }],
    ['command timeout above maximum', { commandTimeoutMilliseconds: 501 }],
    ['shutdown timeout below minimum', { shutdownTimeoutMilliseconds: 99 }],
    ['shutdown timeout above maximum', { shutdownTimeoutMilliseconds: 10_001 }],
    ['host control character', { host: 'cache\u0000example' }],
    ['bracketed IP host', { host: '[::1]' }],
    ['host with embedded port', { host: 'cache.example:6379' }],
    ['host with empty label', { host: 'cache..example' }],
    ['host with oversized label', { host: `${'a'.repeat(64)}.example` }],
    ['invalid numeric IPv4 lookalike', { host: '127.0.0.999' }],
    ['legacy hexadecimal IPv4 lookalike', { host: '0x7f000001' }],
    ['mixed hexadecimal IPv4 lookalike', { host: '0x7f.0.0.1' }],
    ['Unicode host without explicit punycode', { host: 'éxample.test' }],
    ['empty username', { username: '' }],
    ['username whitespace', { username: 'oms app' }],
    ['username newline', { username: 'oms\napp' }],
  ] as const)('rejects %s', (_scenario, override): void => {
    const error = captureError(() =>
      createRedisRuntimeWithClientFactory(
        redisOptions(override),
        fakeRedisClientFactory(fakeRedisClient()),
      ),
    );

    expectSafeUnavailable(error);
  });

  it('rejects accessor, extra-property, proxied, and structurally invalid options safely', (): void => {
    const secret = 'hostile-runtime-option-secret';
    const accessor = redisOptions() as RedisConnectionOptions & { host: string };
    Object.defineProperty(accessor, 'host', {
      enumerable: true,
      get(): never {
        throw new Error(secret);
      },
    });
    const extra = { ...redisOptions(), url: `redis://default:${secret}@redis.invalid` };
    const proxy = new Proxy(redisOptions(), {
      ownKeys(): never {
        throw new Error(secret);
      },
    });

    for (const value of [accessor, extra, proxy, null, 'redis-options']) {
      const error = captureError(() =>
        createRedisRuntimeWithClientFactory(value, fakeRedisClientFactory(fakeRedisClient())),
      );

      expectSafeUnavailable(error, secret);
    }
  });
});
