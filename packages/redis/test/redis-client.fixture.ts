import type { ManagedRedisClient, RedisClientFactory } from '../src/client/redis-client';
import type { RedisConnectionOptions } from '../src/redis.contract';

export interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: Value | PromiseLike<Value>) => void;
}

export function blockEventLoop(milliseconds: number): void {
  const blocker = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(blocker, 0, 0, milliseconds);
}

export function deferred<Value>(): Deferred<Value> {
  let rejectPromise: (reason: unknown) => void = (): void => undefined;
  let resolvePromise: (value: Value | PromiseLike<Value>) => void = (): void => undefined;
  const promise = new Promise<Value>((resolve, reject): void => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

export interface FakeRedisClientControl {
  readonly client: ManagedRedisClient;
  readonly connect: jest.MockedFunction<ManagedRedisClient['connect']>;
  readonly destroy: jest.MockedFunction<ManagedRedisClient['destroy']>;
  readonly evaluate: jest.MockedFunction<ManagedRedisClient['evaluate']>;
  readonly evaluateSha: jest.MockedFunction<ManagedRedisClient['evaluateSha']>;
  readonly events: string[];
  readonly onError: jest.MockedFunction<ManagedRedisClient['onError']>;
  readonly ping: jest.MockedFunction<ManagedRedisClient['ping']>;
  emitError(error: unknown): void;
  setOpen(value: boolean): void;
  setReady(value: boolean): void;
  setReadyReadFailure(error: Error): void;
}

export function fakeRedisClient(
  overrides: Partial<
    Pick<ManagedRedisClient, 'connect' | 'evaluate' | 'evaluateSha' | 'onError' | 'ping'>
  > = {},
): FakeRedisClientControl {
  let errorListener: ((error: unknown) => void) | undefined;
  let open = false;
  let ready = false;
  let readyReadFailure: Error | undefined;
  const events: string[] = [];
  const connect = jest.fn<
    ReturnType<ManagedRedisClient['connect']>,
    Parameters<ManagedRedisClient['connect']>
  >((): Promise<void> => {
    events.push('connect');
    open = true;
    ready = true;
    return Promise.resolve();
  });
  const destroy = jest.fn<
    ReturnType<ManagedRedisClient['destroy']>,
    Parameters<ManagedRedisClient['destroy']>
  >((): void => {
    events.push('destroy');
    open = false;
    ready = false;
  });
  const evaluate = jest.fn<
    ReturnType<ManagedRedisClient['evaluate']>,
    Parameters<ManagedRedisClient['evaluate']>
  >((source, keys, arguments_, abortSignal): Promise<unknown> => {
    void source;
    void keys;
    void arguments_;
    void abortSignal;
    return Promise.resolve('evaluated');
  });
  const evaluateSha = jest.fn<
    ReturnType<ManagedRedisClient['evaluateSha']>,
    Parameters<ManagedRedisClient['evaluateSha']>
  >((digest, keys, arguments_, abortSignal): Promise<unknown> => {
    void digest;
    void keys;
    void arguments_;
    void abortSignal;
    return Promise.resolve('evaluated-sha');
  });
  const onError = jest.fn<
    ReturnType<ManagedRedisClient['onError']>,
    Parameters<ManagedRedisClient['onError']>
  >((listener): void => {
    events.push('error-listener');
    errorListener = listener;
  });
  const ping = jest.fn<
    ReturnType<ManagedRedisClient['ping']>,
    Parameters<ManagedRedisClient['ping']>
  >((abortSignal): Promise<unknown> => {
    void abortSignal;
    return Promise.resolve('PONG');
  });

  if (overrides.connect !== undefined) {
    connect.mockImplementation(overrides.connect);
  }

  if (overrides.evaluate !== undefined) {
    evaluate.mockImplementation(overrides.evaluate);
  }

  if (overrides.evaluateSha !== undefined) {
    evaluateSha.mockImplementation(overrides.evaluateSha);
  }

  if (overrides.onError !== undefined) {
    onError.mockImplementation(overrides.onError);
  }

  if (overrides.ping !== undefined) {
    ping.mockImplementation(overrides.ping);
  }

  const client: ManagedRedisClient = {
    get isOpen(): boolean {
      return open;
    },
    get isReady(): boolean {
      if (readyReadFailure !== undefined) {
        throw readyReadFailure;
      }

      return ready;
    },
    connect,
    destroy,
    evaluate,
    evaluateSha,
    onError,
    ping,
  };

  return {
    client,
    connect,
    destroy,
    emitError(error: unknown): void {
      errorListener?.(error);
    },
    evaluate,
    evaluateSha,
    events,
    onError,
    ping,
    setOpen(value: boolean): void {
      open = value;
    },
    setReady(value: boolean): void {
      ready = value;
    },
    setReadyReadFailure(error: Error): void {
      readyReadFailure = error;
    },
  };
}

export function fakeRedisClientFactory(
  ...clients: readonly FakeRedisClientControl[]
): jest.MockedFunction<RedisClientFactory> {
  let index = 0;

  return jest.fn((options: RedisConnectionOptions): ManagedRedisClient => {
    void options;
    const control = clients[index];
    index += 1;

    if (control === undefined) {
      throw new Error('Unexpected Redis client allocation');
    }

    return control.client;
  });
}

export function redisOptions(
  overrides: Partial<RedisConnectionOptions> = {},
): RedisConnectionOptions {
  return {
    commandQueueLimit: 256,
    commandTimeoutMilliseconds: 100,
    connectTimeoutMilliseconds: 2_000,
    host: '127.0.0.1',
    password: 'redis-test-password',
    port: 6_379,
    probeTimeoutMilliseconds: 500,
    shutdownTimeoutMilliseconds: 1_000,
    tls: { enabled: false },
    username: 'oms_app',
    ...overrides,
  };
}
