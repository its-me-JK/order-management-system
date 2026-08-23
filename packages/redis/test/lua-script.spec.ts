import { createHash } from 'node:crypto';
import { inspect } from 'node:util';

import { ErrorReply } from '@redis/client';

import { InvalidRedisLuaScriptError, type RedisLuaScript } from '../src/lua-script.contract';
import { defineRedisLuaScript } from '../src/lua-script.definition';
import { createRedisLuaScriptExecutor } from '../src/lua-script.executor';
import { RedisRuntimeUnavailableError, type RedisRuntime } from '../src/redis.contract';
import { createRedisRuntimeWithClientFactory } from '../src/redis-runtime';
import {
  blockEventLoop,
  deferred,
  fakeRedisClient,
  fakeRedisClientFactory,
  redisOptions,
} from './redis-client.fixture';

const SCRIPT_SOURCE = 'return {KEYS[1], ARGV[1]}';
const SCRIPT_DIGEST = createHash('sha1').update(SCRIPT_SOURCE, 'utf8').digest('hex');

function runtimeWith(...clients: readonly ReturnType<typeof fakeRedisClient>[]): RedisRuntime {
  return createRedisRuntimeWithClientFactory(redisOptions(), fakeRedisClientFactory(...clients));
}

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

function forgeErrorReply(message: string): ErrorReply {
  const reply = Object.create(ErrorReply.prototype) as ErrorReply;
  Object.defineProperty(reply, 'message', { value: message });
  return reply;
}

function expectInvalidScript(error: unknown, secret?: string): void {
  expect(error).toBeInstanceOf(InvalidRedisLuaScriptError);
  expect(error).toMatchObject({
    message: 'Invalid Redis Lua script value',
    name: 'InvalidRedisLuaScriptError',
  });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  if (secret !== undefined) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  }
}

function expectUnavailable(error: unknown, secret?: string): void {
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

describe('@oms/redis static Lua scripts', (): void => {
  it('registers a frozen source-redacting definition with no public data', (): void => {
    const secretSource = "return 'source-must-remain-private'";
    const script = defineRedisLuaScript(secretSource, 0, 0);

    expect(Object.isFrozen(script)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(script))).toBe(true);
    expect(Object.isFrozen((script as unknown as { constructor: object }).constructor)).toBe(true);
    expect(Object.getOwnPropertyNames(script)).toEqual([]);
    expect(String(script)).toBe('[REDACTED]');
    expect(JSON.stringify(script)).toBe('"[REDACTED]"');
    expect(inspect(script)).toBe('[REDACTED]');
    expect(inspect(script)).not.toContain(secretSource);
  });

  it('accepts every exact definition boundary', (): void => {
    expect(() => defineRedisLuaScript('x'.repeat(32_768), 16, 64)).not.toThrow();
    expect(() => defineRedisLuaScript('return 1', 0, 0)).not.toThrow();
  });

  it.each([
    ['empty source', '', 0, 0],
    ['oversized source', 'x'.repeat(32_769), 0, 0],
    ['unpaired source surrogate', '\ud800', 0, 0],
    ['negative key count', SCRIPT_SOURCE, -1, 1],
    ['fractional key count', SCRIPT_SOURCE, 0.5, 1],
    ['excessive key count', SCRIPT_SOURCE, 17, 1],
    ['negative argument count', SCRIPT_SOURCE, 1, -1],
    ['fractional argument count', SCRIPT_SOURCE, 1, 0.5],
    ['excessive argument count', SCRIPT_SOURCE, 1, 65],
  ] as const)('rejects %s', (_scenario, source, keys, arguments_): void => {
    expectInvalidScript(captureError(() => defineRedisLuaScript(source, keys, arguments_)));
  });

  it('rejects boxed, proxied, and hostile source values without leaking trap errors', (): void => {
    const secret = 'hostile-script-source-secret';
    const boxedSource = { valueOf: (): string => SCRIPT_SOURCE };
    const proxy = new Proxy(boxedSource, {
      getPrototypeOf(): never {
        throw new Error(secret);
      },
    });

    for (const source of [boxedSource, proxy, null, new Uint8Array([1])]) {
      expectInvalidScript(
        captureError(() => defineRedisLuaScript(source, 1, 1)),
        secret,
      );
    }
  });

  it('seals construction and rejects clones, descendants, and proxies at execution', async (): Promise<void> => {
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const executor = createRedisLuaScriptExecutor(runtimeWith(fakeRedisClient()));
    const constructor = (
      script as unknown as { constructor: new (...arguments_: unknown[]) => object }
    ).constructor;

    expectInvalidScript(captureError(() => new constructor({}, {})));

    for (const candidate of [{}, Object.create(script) as object, new Proxy(script, {})]) {
      const failure = await executor
        .execute(candidate as RedisLuaScript, ['key'], ['argument'])
        .catch((error: unknown): unknown => error);
      expectInvalidScript(failure);
    }
  });

  it('rejects a forged runtime and freezes each authentic executor', (): void => {
    expectInvalidScript(
      captureError(() =>
        createRedisLuaScriptExecutor({ connection: {}, close: jest.fn() } as never),
      ),
    );
    expectInvalidScript(
      captureError(() => createRedisLuaScriptExecutor(new Proxy({} as RedisRuntime, {}))),
    );

    const executor = createRedisLuaScriptExecutor(runtimeWith(fakeRedisClient()));
    expect(Object.isFrozen(executor)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(executor))).toBe(true);
  });

  it('executes EVALSHA with the static digest and defensive frozen primitive copies', async (): Promise<void> => {
    const connectSettlement = deferred<undefined>();
    const control = fakeRedisClient({ connect: (): Promise<void> => connectSettlement.promise });
    const executor = createRedisLuaScriptExecutor(runtimeWith(control));
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const keys = ['oms:{identity-abuse}:network'];
    const arguments_ = ['42'];
    const operation = executor.execute(script, keys, arguments_);

    keys[0] = 'mutated-key';
    arguments_[0] = 'mutated-argument';
    control.setOpen(true);
    control.setReady(true);
    connectSettlement.resolve(undefined);

    await expect(operation).resolves.toBe('evaluated-sha');
    expect(control.evaluateSha).toHaveBeenCalledTimes(1);
    const [digest, copiedKeys, copiedArguments, abortSignal] =
      control.evaluateSha.mock.calls[0] ?? [];
    expect(digest).toBe(SCRIPT_DIGEST);
    expect(copiedKeys).toEqual(['oms:{identity-abuse}:network']);
    expect(copiedArguments).toEqual(['42']);
    expect(Object.isFrozen(copiedKeys)).toBe(true);
    expect(Object.isFrozen(copiedArguments)).toBe(true);
    expect(abortSignal).toBeInstanceOf(AbortSignal);
    expect(control.evaluate).not.toHaveBeenCalled();
  });

  it('accepts exact execution boundaries including an empty argument', async (): Promise<void> => {
    const control = fakeRedisClient();
    const executor = createRedisLuaScriptExecutor(runtimeWith(control));
    const script = defineRedisLuaScript('return 1', 16, 64);
    const keys = Array.from({ length: 16 }, (_, index): string => String(index) + 'k'.repeat(510));
    const arguments_ = Array.from({ length: 64 }, (): string => 'a'.repeat(4_096));
    arguments_[0] = '';

    await expect(executor.execute(script, keys, arguments_)).resolves.toBe('evaluated-sha');
  });

  it('rejects wrong arity, sparse, accessor, extra-property, proxied, and non-string arrays', async (): Promise<void> => {
    const secret = 'hostile-script-array-secret';
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const executor = createRedisLuaScriptExecutor(runtimeWith(fakeRedisClient()));
    const accessor = ['key'];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get(): never {
        throw new Error(secret);
      },
    });
    const extra = ['key'] as string[] & { extra?: string };
    extra.extra = secret;
    const proxy = new Proxy(['key'], {
      ownKeys(): never {
        throw new Error(secret);
      },
    });
    const sparse = new Array<string>(1);

    for (const keys of [[], ['one', 'two'], accessor, extra, proxy, sparse, [Object('key')]]) {
      const failure = await executor
        .execute(script, keys as readonly string[], ['argument'])
        .catch((error: unknown): unknown => error);
      expectInvalidScript(failure, secret);
    }

    for (const arguments_ of [[], ['one', 'two'], [Object('argument')]]) {
      const failure = await executor
        .execute(script, ['key'], arguments_ as readonly string[])
        .catch((error: unknown): unknown => error);
      expectInvalidScript(failure);
    }
  });

  it('rejects oversized keys and arguments before allocating a client', async (): Promise<void> => {
    const factory = fakeRedisClientFactory(fakeRedisClient());
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    await expect(executor.execute(script, ['k'.repeat(513)], ['argument'])).rejects.toBeInstanceOf(
      InvalidRedisLuaScriptError,
    );
    await expect(executor.execute(script, ['key'], ['a'.repeat(4_097)])).rejects.toBeInstanceOf(
      InvalidRedisLuaScriptError,
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it('uses exactly one EVAL fallback for an authentic NOSCRIPT reply and one deadline', async (): Promise<void> => {
    const control = fakeRedisClient({
      evaluate: (): Promise<unknown> => Promise.resolve(['allowed']),
      evaluateSha: (): Promise<unknown> =>
        Promise.reject(new ErrorReply('NOSCRIPT No matching script. Please use EVAL.')),
    });
    const executor = createRedisLuaScriptExecutor(runtimeWith(control));
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toEqual(['allowed']);
    expect(control.evaluateSha).toHaveBeenCalledTimes(1);
    expect(control.evaluate).toHaveBeenCalledTimes(1);
    expect(control.evaluate.mock.calls[0]?.[3]).toBe(control.evaluateSha.mock.calls[0]?.[3]);
    expect(control.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['ordinary lookalike', new Error('NOSCRIPT No matching script. Please use EVAL.')],
    ['other provider reply', new ErrorReply('BUSY Redis is busy')],
    ['bare code', new ErrorReply('NOSCRIPT')],
    ['forged script reply', new ErrorReply('NOSCRIPT forged')],
    [
      'canonical prefix variant',
      new ErrorReply('ERR NOSCRIPT No matching script. Please use EVAL.'),
    ],
    [
      'canonical suffix variant',
      new ErrorReply('NOSCRIPT No matching script. Please use EVAL. forged'),
    ],
    ['truncated canonical reply', new ErrorReply('NOSCRIPT No matching script. Please use EVAL')],
    ['prototype forgery', forgeErrorReply('NOSCRIPT No matching script. Please use EVAL.')],
    ['proxied reply', new Proxy(new ErrorReply('NOSCRIPT No matching script'), {})],
  ] as const)('does not retry %s', async (_scenario, reply): Promise<void> => {
    const first = fakeRedisClient({
      evaluateSha: (): Promise<unknown> => Promise.reject(reply),
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(redisOptions(), factory);
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    await expect(executor.execute(script, ['key'], ['argument'])).rejects.toBeInstanceOf(
      RedisRuntimeUnavailableError,
    );
    expect(first.evaluateSha).toHaveBeenCalledTimes(1);
    expect(first.evaluate).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toBe('evaluated-sha');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed EVAL fallback and reconnects only on a later call', async (): Promise<void> => {
    const secret = 'eval-fallback-provider-secret';
    const first = fakeRedisClient({
      evaluate: (): Promise<unknown> => Promise.reject(new Error(secret)),
      evaluateSha: (): Promise<unknown> =>
        Promise.reject(new ErrorReply('NOSCRIPT No matching script. Please use EVAL.')),
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const executor = createRedisLuaScriptExecutor(
      createRedisRuntimeWithClientFactory(redisOptions(), factory),
    );
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    const failure = await executor
      .execute(script, ['key'], ['argument'])
      .catch((error: unknown): unknown => error);

    expectUnavailable(failure, secret);
    expect(first.evaluateSha).toHaveBeenCalledTimes(1);
    expect(first.evaluate).toHaveBeenCalledTimes(1);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toBe('evaluated-sha');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('enforces the command watchdog when the provider ignores AbortSignal', async (): Promise<void> => {
    const commandSettlement = deferred<unknown>();
    const first = fakeRedisClient({
      evaluateSha: (): Promise<unknown> => commandSettlement.promise,
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandTimeoutMilliseconds: 25 }),
      factory,
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    await expect(executor.execute(script, ['key'], ['argument'])).rejects.toBeInstanceOf(
      RedisRuntimeUnavailableError,
    );
    expect(first.evaluateSha).toHaveBeenCalledTimes(1);
    expect(first.evaluate).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    commandSettlement.resolve('late-provider-reply');
    await nextEventLoopTurn();
    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toBe('evaluated-sha');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects late EVALSHA success after monotonic expiry before timer delivery', async (): Promise<void> => {
    const first = fakeRedisClient({
      evaluateSha: (): Promise<unknown> => {
        blockEventLoop(40);
        return Promise.resolve('late-success');
      },
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandTimeoutMilliseconds: 25 }),
      factory,
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    await expect(executor.execute(script, ['key'], ['argument'])).rejects.toBeInstanceOf(
      RedisRuntimeUnavailableError,
    );
    expect(first.evaluateSha).toHaveBeenCalledTimes(1);
    expect(first.evaluate).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toBe('evaluated-sha');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('never falls back for canonical NOSCRIPT received after monotonic expiry', async (): Promise<void> => {
    const first = fakeRedisClient({
      evaluateSha: (): Promise<unknown> => {
        blockEventLoop(40);
        return Promise.reject(new ErrorReply('NOSCRIPT No matching script. Please use EVAL.'));
      },
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandTimeoutMilliseconds: 25 }),
      factory,
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    await expect(executor.execute(script, ['key'], ['argument'])).rejects.toBeInstanceOf(
      RedisRuntimeUnavailableError,
    );
    expect(first.evaluateSha).toHaveBeenCalledTimes(1);
    expect(first.evaluate).not.toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalledTimes(1);

    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toBe('evaluated-sha');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('keeps one watchdog deadline across NOSCRIPT fallback when EVAL never settles', async (): Promise<void> => {
    const fallbackSettlement = deferred<unknown>();
    const first = fakeRedisClient({
      evaluate: (): Promise<unknown> => fallbackSettlement.promise,
      evaluateSha: (): Promise<unknown> =>
        Promise.reject(new ErrorReply('NOSCRIPT No matching script. Please use EVAL.')),
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandTimeoutMilliseconds: 25 }),
      factory,
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    await expect(executor.execute(script, ['key'], ['argument'])).rejects.toBeInstanceOf(
      RedisRuntimeUnavailableError,
    );
    expect(first.evaluateSha).toHaveBeenCalledTimes(1);
    expect(first.evaluate).toHaveBeenCalledTimes(1);
    expect(first.evaluate.mock.calls[0]?.[3]).toBe(first.evaluateSha.mock.calls[0]?.[3]);
    expect(first.destroy).toHaveBeenCalledTimes(1);

    fallbackSettlement.resolve('late-fallback-reply');
    await nextEventLoopTurn();
    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toBe('evaluated-sha');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects another operation that settles after a concurrent timeout discarded its client', async (): Promise<void> => {
    const firstSettlement = deferred<unknown>();
    const secondSettlement = deferred<unknown>();
    const first = fakeRedisClient({
      evaluateSha: (): Promise<unknown> =>
        first.evaluateSha.mock.calls.length === 1
          ? firstSettlement.promise
          : secondSettlement.promise,
    });
    const second = fakeRedisClient();
    const factory = fakeRedisClientFactory(first, second);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandTimeoutMilliseconds: 100 }),
      factory,
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const firstOperation = executor.execute(script, ['key-1'], ['argument-1']);

    await new Promise((resolve): void => {
      setTimeout(resolve, 40);
    });
    const secondOperation = executor.execute(script, ['key-2'], ['argument-2']);
    await nextEventLoopTurn();
    await expect(firstOperation).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(first.destroy).toHaveBeenCalledTimes(1);

    secondSettlement.resolve('stale-success');
    await expect(secondOperation).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    firstSettlement.resolve('later-stale-success');
    await nextEventLoopTurn();

    await expect(executor.execute(script, ['key-3'], ['argument-3'])).resolves.toBe(
      'evaluated-sha',
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects provider fulfillment after shutdown has exhausted its shorter grace', async (): Promise<void> => {
    const commandSettlement = deferred<unknown>();
    const control = fakeRedisClient({
      evaluateSha: (): Promise<unknown> => commandSettlement.promise,
    });
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({
        commandTimeoutMilliseconds: 500,
        shutdownTimeoutMilliseconds: 100,
      }),
      fakeRedisClientFactory(control),
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const operation = executor.execute(script, ['key'], ['argument']);

    await nextEventLoopTurn();
    expect(control.evaluateSha).toHaveBeenCalledTimes(1);
    await expect(runtime.close()).resolves.toBeUndefined();
    expect(control.destroy).toHaveBeenCalledTimes(1);

    commandSettlement.resolve('stale-after-close');
    await expect(operation).rejects.toBeInstanceOf(RedisRuntimeUnavailableError);
    expect(control.destroy).toHaveBeenCalledTimes(1);
  });

  it('caps pending-connect script admissions and reclaims capacity after settlement', async (): Promise<void> => {
    const connectSettlement = deferred<undefined>();
    const control = fakeRedisClient({ connect: (): Promise<void> => connectSettlement.promise });
    const factory = fakeRedisClientFactory(control);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandQueueLimit: 2 }),
      factory,
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);

    const first = executor.execute(script, ['key-1'], ['argument-1']);
    const second = executor.execute(script, ['key-2'], ['argument-2']);
    const saturated = await executor
      .execute(script, ['key-3'], ['argument-3'])
      .catch((error: unknown): unknown => error);

    expectUnavailable(saturated);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(control.connect).toHaveBeenCalledTimes(1);
    expect(control.evaluateSha).not.toHaveBeenCalled();

    control.setOpen(true);
    control.setReady(true);
    connectSettlement.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual(['evaluated-sha', 'evaluated-sha']);
    expect(control.evaluateSha).toHaveBeenCalledTimes(2);

    await expect(executor.execute(script, ['key-4'], ['argument-4'])).resolves.toBe(
      'evaluated-sha',
    );
    expect(control.evaluateSha).toHaveBeenCalledTimes(3);
  });

  it('does not prepare saturated input and reclaims capacity after preparation failure', async (): Promise<void> => {
    const secret = 'saturated-hostile-key-getter';
    const connectSettlement = deferred<undefined>();
    const control = fakeRedisClient({ connect: (): Promise<void> => connectSettlement.promise });
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandQueueLimit: 1 }),
      fakeRedisClientFactory(control),
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const admitted = executor.execute(script, ['key-1'], ['argument-1']);
    let getterInvocations = 0;
    const hostileKeys = ['unused'];
    Object.defineProperty(hostileKeys, '0', {
      enumerable: true,
      get(): never {
        getterInvocations += 1;
        throw new Error(secret);
      },
    });

    const saturatedFailure = await executor
      .execute(script, hostileKeys, ['argument-2'])
      .catch((error: unknown): unknown => error);
    expectUnavailable(saturatedFailure, secret);
    expect(getterInvocations).toBe(0);

    control.setOpen(true);
    control.setReady(true);
    connectSettlement.resolve(undefined);
    await expect(admitted).resolves.toBe('evaluated-sha');

    const preparationFailure = await executor
      .execute(script, hostileKeys, ['argument-2'])
      .catch((error: unknown): unknown => error);
    expectInvalidScript(preparationFailure, secret);
    expect(getterInvocations).toBe(0);

    await expect(executor.execute(script, ['key-3'], ['argument-3'])).resolves.toBe(
      'evaluated-sha',
    );
    expect(control.evaluateSha).toHaveBeenCalledTimes(2);
  });

  it('reclaims pending-connect admission capacity after failure', async (): Promise<void> => {
    const secret = 'pending-connect-provider-secret';
    const connectSettlement = deferred<undefined>();
    const firstControl = fakeRedisClient({
      connect: (): Promise<void> => connectSettlement.promise,
    });
    const secondControl = fakeRedisClient();
    const factory = fakeRedisClientFactory(firstControl, secondControl);
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandQueueLimit: 1 }),
      factory,
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const admittedFailure = executor
      .execute(script, ['key-1'], ['argument-1'])
      .catch((error: unknown): unknown => error);
    const saturatedFailure = await executor
      .execute(script, ['key-2'], ['argument-2'])
      .catch((error: unknown): unknown => error);

    expectUnavailable(saturatedFailure);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(firstControl.connect).toHaveBeenCalledTimes(1);
    connectSettlement.reject(new Error(secret));

    expectUnavailable(await admittedFailure, secret);
    expect(firstControl.destroy).toHaveBeenCalledTimes(1);
    await expect(executor.execute(script, ['key-3'], ['argument-3'])).resolves.toBe(
      'evaluated-sha',
    );
    expect(factory).toHaveBeenCalledTimes(2);
    expect(secondControl.evaluateSha).toHaveBeenCalledTimes(1);
  });

  it('shares one admission for probe fan-out and applies the budget to scripts', async (): Promise<void> => {
    const pingSettlement = deferred<unknown>();
    const control = fakeRedisClient({ ping: (): Promise<unknown> => pingSettlement.promise });
    const runtime = createRedisRuntimeWithClientFactory(
      redisOptions({ commandQueueLimit: 1 }),
      fakeRedisClientFactory(control),
    );
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const firstProbe = runtime.connection.probe();
    const secondProbe = runtime.connection.probe();

    expect(firstProbe).toBe(secondProbe);
    const saturatedFailure = await executor
      .execute(script, ['key'], ['argument'])
      .catch((error: unknown): unknown => error);
    expectUnavailable(saturatedFailure);
    await nextEventLoopTurn();
    expect(control.ping).toHaveBeenCalledTimes(1);
    expect(control.evaluateSha).not.toHaveBeenCalled();

    pingSettlement.resolve('PONG');
    await expect(Promise.all([firstProbe, secondProbe])).resolves.toEqual([undefined, undefined]);
    await expect(executor.execute(script, ['key'], ['argument'])).resolves.toBe('evaluated-sha');
  });

  it('lets shutdown wait for an admitted script and rejects later scripts', async (): Promise<void> => {
    const scriptSettlement = deferred<unknown>();
    const control = fakeRedisClient({
      evaluateSha: (): Promise<unknown> => scriptSettlement.promise,
    });
    const runtime = runtimeWith(control);
    const executor = createRedisLuaScriptExecutor(runtime);
    const script = defineRedisLuaScript(SCRIPT_SOURCE, 1, 1);
    const operation = executor.execute(script, ['key'], ['argument']);

    await nextEventLoopTurn();
    expect(control.evaluateSha).toHaveBeenCalledTimes(1);
    const close = runtime.close();
    expect(control.destroy).not.toHaveBeenCalled();

    scriptSettlement.resolve('settled');
    await expect(Promise.all([operation, close])).resolves.toEqual(['settled', undefined]);
    expect(control.destroy).toHaveBeenCalledTimes(1);
    await expect(executor.execute(script, ['key'], ['argument'])).rejects.toBeInstanceOf(
      RedisRuntimeUnavailableError,
    );
  });
});
