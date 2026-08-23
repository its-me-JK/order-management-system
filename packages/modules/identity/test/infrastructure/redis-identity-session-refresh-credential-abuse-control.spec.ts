import { inspect } from 'node:util';

import type { RedisLuaScript, RedisLuaScriptExecutor } from '@oms/redis/lua-script';

import { createIdentityCredentialAbuseNetworkFromAddressBytes } from '../../src/application/identity-credential-abuse-network';
import {
  authenticateIdentityCredentialAbuseDecision,
  IdentityCredentialAbuseControlError,
  IdentityCredentialAbuseControlUnavailableError,
  type IdentityCredentialAbuseDecision,
  type IdentitySessionRefreshCredentialAbuseAdmission,
} from '../../src/application/identity-session-refresh-credential-abuse-control';
import { parseIdentityRefreshCredentialWireValue } from '../../src/application/identity-session-credential-wire.values';
import {
  createRedisIdentitySessionRefreshCredentialAbuseControl,
  type RedisIdentityCredentialAbuseBucketPolicy,
  type RedisIdentitySessionRefreshCredentialAbuseControlOptions,
} from '../../src/infrastructure/redis/redis-identity-session-refresh-credential-abuse-control';
import type {
  // @ts-expect-error The application port remains package-internal.
  IdentitySessionRefreshCredentialAbuseControl as LeakedSubpathPort,
  // @ts-expect-error The application decision remains package-internal.
  IdentityCredentialAbuseDecision as LeakedSubpathDecision,
} from '../../src/infrastructure/redis';
import * as redisInfrastructurePublicApi from '../../src/infrastructure/redis';
import { REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT_SOURCE } from '../../src/infrastructure/redis/redis-identity-session-refresh-abuse.lua-script';
import type {
  // @ts-expect-error The Redis adapter belongs only to its restricted infrastructure subpath.
  createRedisIdentitySessionRefreshCredentialAbuseControl as LeakedRootFactory,
  // @ts-expect-error Redis adapter options remain outside the package root.
  RedisIdentitySessionRefreshCredentialAbuseControlOptions as LeakedRootOptions,
} from '../../src';
import * as identityPublicApi from '../../src';

const REFRESH_WIRE_VALUE = 'oms_rt_v1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const SECOND_REFRESH_WIRE_VALUE = 'oms_rt_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ERROR_MESSAGE = 'Identity credential abuse control failed';
const UNAVAILABLE_MESSAGE = 'Identity credential abuse control is temporarily unavailable';

type Invocation = Readonly<{
  script: RedisLuaScript;
  keys: readonly string[];
  arguments_: readonly string[];
}>;

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function policy(
  capacity: number,
  tokenIntervalMicroseconds: number,
): RedisIdentityCredentialAbuseBucketPolicy {
  return Object.freeze({ capacity, tokenIntervalMicroseconds });
}

function secret(fill = 0x5a): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(32);
  value.fill(fill);
  return value;
}

function resizableSecret(): Uint8Array<ArrayBuffer> {
  const ResizableArrayBufferConstructor = ArrayBuffer as unknown as new (
    byteLength: number,
    options: Readonly<{ maxByteLength: number }>,
  ) => ArrayBuffer;
  const buffer = new ResizableArrayBufferConstructor(32, { maxByteLength: 64 });

  return new Uint8Array(buffer);
}

function options(
  overrides: Partial<RedisIdentitySessionRefreshCredentialAbuseControlOptions> = {},
): RedisIdentitySessionRefreshCredentialAbuseControlOptions {
  return Object.freeze({
    deploymentNamespace: overrides.deploymentNamespace ?? 'showcase-in',
    keyEpoch: overrides.keyEpoch ?? '2026q3',
    hmacSecret: overrides.hmacSecret ?? secret(),
    deployment: overrides.deployment ?? policy(300, 200_000),
    network: overrides.network ?? policy(120, 2_500_000),
    presentedCredential: overrides.presentedCredential ?? policy(3, 100_000_000),
  });
}

function admission(
  lastIpv4Octet = 29,
  wireValue = REFRESH_WIRE_VALUE,
): IdentitySessionRefreshCredentialAbuseAdmission {
  return Object.freeze({
    network: createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      Uint8Array.of(203, 0, 113, lastIpv4Octet),
    ),
    presentedRefreshCredential: parseIdentityRefreshCredentialWireValue(wireValue),
  });
}

function fakeExecutor(
  result: () => Promise<unknown> = (): Promise<unknown> => Promise.resolve(['v1', 'allowed', '0']),
): Readonly<{
  executor: RedisLuaScriptExecutor;
  invocations: Invocation[];
}> {
  const invocations: Invocation[] = [];
  const executor: RedisLuaScriptExecutor = {
    execute(
      script: RedisLuaScript,
      keys: readonly string[],
      arguments_: readonly string[],
    ): Promise<unknown> {
      invocations.push(Object.freeze({ script, keys, arguments_ }));
      return result();
    },
  };

  return { executor, invocations };
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

async function captureAsyncError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to reject with an Error');
}

function expectFixedError(
  error: Error,
  ExpectedError: ErrorClass,
  expectedMessage: string,
  rejectedValues: readonly string[] = [],
): void {
  expect(error).toBeInstanceOf(ExpectedError);
  expect(error).toMatchObject({ name: ExpectedError.name, message: expectedMessage });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const value of rejectedValues) {
    expect(String(error)).not.toContain(value);
    expect(JSON.stringify(error)).not.toContain(value);
    expect(error.stack ?? '').not.toContain(value);
  }
}

function expectConfigurationFailure(value: unknown): void {
  const { executor } = fakeExecutor();
  const error = captureError(() =>
    createRedisIdentitySessionRefreshCredentialAbuseControl(
      executor,
      value as RedisIdentitySessionRefreshCredentialAbuseControlOptions,
    ),
  );

  expectFixedError(error, IdentityCredentialAbuseControlError, ERROR_MESSAGE);
}

describe('Redis Identity refresh abuse adapter invocation', (): void => {
  it('matches the reviewed full invocation known-answer vector', async (): Promise<void> => {
    const hmacSecret = Uint8Array.from({ length: 32 }, (_unused, index): number => index);
    const harness = fakeExecutor();
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(
      harness.executor,
      options({
        deploymentNamespace: 'showcase.in-1',
        keyEpoch: 'v1.2026-q3',
        hmacSecret,
      }),
    );

    await control.admitSessionRefresh(admission(29, REFRESH_WIRE_VALUE));

    const invocation = harness.invocations[0];

    if (invocation === undefined) {
      throw new Error('Expected the known-answer invocation');
    }

    // These values were independently derived from the reviewed binary framing contract. They
    // deliberately do not reuse an implementation helper, so framing, order, version, digest,
    // Base64url, hexadecimal, or policy-order drift fails this test.
    expect(invocation.keys).toEqual([
      'oms:{Day_SlmUHIjzJ0CjKzDXmupJxSWTLGW0P-X87XNwdic}:id-abuse-refresh:a1:ev1.2026-q3:m',
      'oms:{Day_SlmUHIjzJ0CjKzDXmupJxSWTLGW0P-X87XNwdic}:id-abuse-refresh:a1:ev1.2026-q3:d:C79h-PJD4zyu5hRDmhNoiKmVqZN8XSefxWuHjHZvrmw',
      'oms:{Day_SlmUHIjzJ0CjKzDXmupJxSWTLGW0P-X87XNwdic}:id-abuse-refresh:a1:ev1.2026-q3:n:YX6NFqoU-Btmw0E6kBLge6IDKFGWzULeauYTtmKOT1k',
      'oms:{Day_SlmUHIjzJ0CjKzDXmupJxSWTLGW0P-X87XNwdic}:id-abuse-refresh:a1:ev1.2026-q3:c:SkLPIMbub93PzzpL07QF7Y8sfF4WoD8nYg4xvSgZYRE',
    ]);
    expect(invocation.arguments_).toEqual([
      '603f63eae5821ea5b47690a5abbea01f3355baa01debe902243070273b53107a',
      '300',
      '200000',
      '120',
      '2500000',
      '3',
      '100000000',
    ]);
  });

  it('issues one exact pseudonymous same-slot four-key/seven-argument operation', async (): Promise<void> => {
    const { executor, invocations } = fakeExecutor();
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());

    const decision = await control.admitSessionRefresh(admission());

    expect(authenticateIdentityCredentialAbuseDecision(decision)).toBe(decision);
    expect(decision).toEqual({ kind: 'allowed' });
    expect(invocations).toHaveLength(1);

    const invocation = invocations[0];

    if (invocation === undefined) {
      throw new Error('Expected one Redis invocation');
    }

    expect(invocation.keys).toHaveLength(4);
    expect(invocation.arguments_).toHaveLength(7);
    expect(Object.isFrozen(invocation.keys)).toBe(true);
    expect(Object.isFrozen(invocation.arguments_)).toBe(true);
    expect(invocation.arguments_).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      '300',
      '200000',
      '120',
      '2500000',
      '3',
      '100000000',
    ]);
    const hashTag = /^oms:\{([A-Za-z0-9_-]{43})\}:id-abuse-refresh:/u.exec(
      invocation.keys[0] ?? '',
    )?.[1];
    expect(hashTag).toBeDefined();
    expect(
      invocation.keys.every((key) => key.startsWith(`oms:{${hashTag ?? ''}}:id-abuse-refresh:`)),
    ).toBe(true);
    expect(invocation.keys).toEqual([
      expect.stringMatching(/^oms:\{[A-Za-z0-9_-]{43}\}:id-abuse-refresh:a1:e2026q3:m$/u),
      expect.stringMatching(
        /^oms:\{[A-Za-z0-9_-]{43}\}:id-abuse-refresh:a1:e2026q3:d:[A-Za-z0-9_-]{43}$/u,
      ),
      expect.stringMatching(
        /^oms:\{[A-Za-z0-9_-]{43}\}:id-abuse-refresh:a1:e2026q3:n:[A-Za-z0-9_-]{43}$/u,
      ),
      expect.stringMatching(
        /^oms:\{[A-Za-z0-9_-]{43}\}:id-abuse-refresh:a1:e2026q3:c:[A-Za-z0-9_-]{43}$/u,
      ),
    ]);

    const serializedInvocation = JSON.stringify(invocation);
    expect(serializedInvocation).not.toContain(REFRESH_WIRE_VALUE);
    expect(serializedInvocation).not.toContain('203.0.113.29');
    expect(serializedInvocation).not.toContain('showcase-in');
    expect(serializedInvocation).not.toContain('ZZZZ');
    expect(String(invocation.script)).toBe('[REDACTED]');
    expect(JSON.stringify(invocation.script)).toBe('"[REDACTED]"');
    expect(inspect(invocation.script)).toBe('[REDACTED]');
  });

  it('derives deterministic dimension-separated keys and changes only the subject dimension', async (): Promise<void> => {
    const harness = fakeExecutor();
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(
      harness.executor,
      options(),
    );

    await control.admitSessionRefresh(admission(29, REFRESH_WIRE_VALUE));
    await control.admitSessionRefresh(admission(29, REFRESH_WIRE_VALUE));
    await control.admitSessionRefresh(admission(30, REFRESH_WIRE_VALUE));
    await control.admitSessionRefresh(admission(29, SECOND_REFRESH_WIRE_VALUE));

    const [first, repeated, changedNetwork, changedCredential] = harness.invocations;

    if (
      first === undefined ||
      repeated === undefined ||
      changedNetwork === undefined ||
      changedCredential === undefined
    ) {
      throw new Error('Expected four captured invocations');
    }

    expect(repeated.keys).toEqual(first.keys);
    expect(changedNetwork.keys.slice(0, 3)).toEqual([
      first.keys[0],
      first.keys[1],
      expect.not.stringMatching(first.keys[2] ?? ''),
    ]);
    expect(changedNetwork.keys[3]).toBe(first.keys[3]);
    expect(changedCredential.keys.slice(0, 3)).toEqual(first.keys.slice(0, 3));
    expect(changedCredential.keys[3]).not.toBe(first.keys[3]);
    expect(new Set(first.keys).size).toBe(4);
  });

  it('changes the slot by scope while secret drift keeps the marker key and changes bucket HMACs', async (): Promise<void> => {
    const firstHarness = fakeExecutor();
    const secondHarness = fakeExecutor();
    const thirdHarness = fakeExecutor();
    const first = createRedisIdentitySessionRefreshCredentialAbuseControl(
      firstHarness.executor,
      options(),
    );
    const second = createRedisIdentitySessionRefreshCredentialAbuseControl(
      secondHarness.executor,
      options({ deploymentNamespace: 'staging-in' }),
    );
    const third = createRedisIdentitySessionRefreshCredentialAbuseControl(
      thirdHarness.executor,
      options({ hmacSecret: secret(0x6b) }),
    );

    await first.admitSessionRefresh(admission());
    await second.admitSessionRefresh(admission());
    await third.admitSessionRefresh(admission());

    const firstInvocation = firstHarness.invocations[0];
    const secondInvocation = secondHarness.invocations[0];
    const thirdInvocation = thirdHarness.invocations[0];

    if (
      firstInvocation === undefined ||
      secondInvocation === undefined ||
      thirdInvocation === undefined
    ) {
      throw new Error('Expected three scoped invocations');
    }

    expect(secondInvocation.keys[0]).not.toBe(firstInvocation.keys[0]);
    expect(thirdInvocation.keys[0]).toBe(firstInvocation.keys[0]);
    expect(thirdInvocation.keys.slice(1)).not.toEqual(firstInvocation.keys.slice(1));
    expect(secondInvocation.arguments_[0]).not.toBe(firstInvocation.arguments_[0]);
    expect(thirdInvocation.arguments_[0]).not.toBe(firstInvocation.arguments_[0]);
  });

  it('copies the HMAC secret and captures the executor operation at construction', async (): Promise<void> => {
    const secretValue = secret(0x33);
    const invocations: Invocation[] = [];
    const mutableExecutor: RedisLuaScriptExecutor = {
      execute(scriptValue, keys, arguments_): Promise<unknown> {
        invocations.push({ script: scriptValue, keys, arguments_ });
        return Promise.resolve(['v1', 'allowed', '0']);
      },
    };
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(
      mutableExecutor,
      options({ hmacSecret: secretValue }),
    );

    await control.admitSessionRefresh(admission());
    secretValue.fill(0xff);
    mutableExecutor.execute = (): never => {
      throw new Error('mutated-executor-secret');
    };
    await control.admitSessionRefresh(admission());

    expect(invocations).toHaveLength(2);
    expect(invocations[1]?.keys).toEqual(invocations[0]?.keys);
    expect(invocations[1]?.arguments_).toEqual(invocations[0]?.arguments_);
  });

  it('returns one frozen narrow port with a receiver-independent captured method', async (): Promise<void> => {
    const { executor } = fakeExecutor();
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());
    const method: unknown = Object.getOwnPropertyDescriptor(control, 'admitSessionRefresh')?.value;

    if (typeof method !== 'function') {
      throw new Error('Expected the captured admission method');
    }

    const decision: unknown = await Reflect.apply(method, Object.freeze({ foreign: true }), [
      admission(),
    ]);

    expect(Object.isFrozen(control)).toBe(true);
    expect(Reflect.ownKeys(control)).toEqual(['admitSessionRefresh']);
    expect(Object.isFrozen(method)).toBe(true);
    expect(decision).toEqual({ kind: 'allowed' });
  });
});

describe('Redis Identity refresh abuse adapter result boundary', (): void => {
  it.each([
    { raw: ['v1', 'denied', '1'], retryAfterSeconds: 1 },
    { raw: ['v1', 'denied', '73'], retryAfterSeconds: 73 },
    { raw: ['v1', 'denied', '180'], retryAfterSeconds: 180 },
  ] as const)(
    'authenticates a denied result with retry $retryAfterSeconds',
    async ({ raw, retryAfterSeconds }): Promise<void> => {
      const { executor } = fakeExecutor((): Promise<unknown> => Promise.resolve([...raw]));
      const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());

      const decision: IdentityCredentialAbuseDecision =
        await control.admitSessionRefresh(admission());

      expect(decision).toEqual({ kind: 'denied', retryAfterSeconds });
      expect(Object.isFrozen(decision)).toBe(true);
      expect(authenticateIdentityCredentialAbuseDecision(decision)).toBe(decision);
    },
  );

  it.each([
    null,
    'v1,allowed,0',
    { 0: 'v1', 1: 'allowed', 2: '0', length: 3 },
    ['v2', 'allowed', '0'],
    ['v1', 'allowed', '1'],
    ['v1', 'denied', '0'],
    ['v1', 'denied', '01'],
    ['v1', 'denied', '181'],
    ['v1', 'denied', 1],
    ['v1', 'unknown', '1'],
    ['v1', 'allowed'],
    ['v1', 'allowed', '0', 'extra'],
    Object.assign(['v1', 'allowed', '0'], { length: 4 }),
  ])('fails closed on malformed fulfilled evidence %#', async (raw): Promise<void> => {
    const { executor } = fakeExecutor((): Promise<unknown> => Promise.resolve(raw));
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());
    const error = await captureAsyncError(() => control.admitSessionRefresh(admission()));

    expectFixedError(error, IdentityCredentialAbuseControlUnavailableError, UNAVAILABLE_MESSAGE);
  });

  it('rejects proxied result evidence without consulting its traps', async (): Promise<void> => {
    const get = jest.fn((_target: string[], _property: string | symbol): undefined => {
      void _target;
      void _property;
      return undefined;
    });
    const result = new Proxy(['v1', 'allowed', '0'], { get });
    const { executor } = fakeExecutor((): Promise<unknown> => Promise.resolve(result));
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());
    const error = await captureAsyncError(() => control.admitSessionRefresh(admission()));

    expectFixedError(error, IdentityCredentialAbuseControlUnavailableError, UNAVAILABLE_MESSAGE);
    // Promise resolution performs the one mandatory thenable check; the adapter performs none.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[1]).toBe('then');
  });

  it('maps a fulfilled result revoked before adapter consumption to safe unavailability', async (): Promise<void> => {
    const result = Proxy.revocable(['v1', 'allowed', '0'], {});
    const fulfilledResult = Promise.resolve(result.proxy);

    await fulfilledResult;
    result.revoke();

    const { executor } = fakeExecutor((): Promise<unknown> => fulfilledResult);
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());
    const error = await captureAsyncError(() => control.admitSessionRefresh(admission()));

    expectFixedError(error, IdentityCredentialAbuseControlUnavailableError, UNAVAILABLE_MESSAGE);
  });

  it('maps synchronous, rejected, and non-Error executor failures to fresh safe unavailability', async (): Promise<void> => {
    const providerSecret = 'redis-provider-secret';
    const failures: readonly (() => Promise<unknown>)[] = [
      (): never => {
        throw new Error(providerSecret);
      },
      (): Promise<unknown> => Promise.reject(new Error(providerSecret)),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Adversarial provider.
      (): Promise<unknown> => Promise.reject(providerSecret),
    ];
    const errors: Error[] = [];

    for (const failure of failures) {
      const { executor } = fakeExecutor(failure);
      const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());
      const error = await captureAsyncError(() => control.admitSessionRefresh(admission()));
      errors.push(error);
      expectFixedError(error, IdentityCredentialAbuseControlUnavailableError, UNAVAILABLE_MESSAGE, [
        providerSecret,
      ]);
    }

    expect(new Set(errors).size).toBe(errors.length);
  });
});

describe('Redis Identity refresh abuse adapter input and configuration boundary', (): void => {
  it('rejects foreign admission values before invoking Redis', async (): Promise<void> => {
    const { executor, invocations } = fakeExecutor();
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(executor, options());
    const valid = admission();
    const candidates: readonly unknown[] = [
      null,
      {},
      { ...valid, extra: true },
      { network: valid.network, presentedRefreshCredential: {} },
      { network: {}, presentedRefreshCredential: valid.presentedRefreshCredential },
      new Proxy(valid, {}),
    ];

    for (const candidate of candidates) {
      const error = await captureAsyncError(() =>
        control.admitSessionRefresh(candidate as IdentitySessionRefreshCredentialAbuseAdmission),
      );
      expectFixedError(error, IdentityCredentialAbuseControlError, ERROR_MESSAGE);
    }

    expect(invocations).toHaveLength(0);
  });

  it.each([
    { name: 'zero capacity', value: options({ deployment: policy(0, 1_000) }) },
    { name: 'excess capacity', value: options({ deployment: policy(10_001, 1_000) }) },
    { name: 'fractional capacity', value: options({ deployment: policy(1.5, 1_000) }) },
    { name: 'short interval', value: options({ network: policy(1, 999) }) },
    {
      name: 'long interval',
      value: options({ network: policy(1, 180_000_001) }),
    },
    {
      name: 'excess full-refill horizon',
      value: options({ presentedCredential: policy(21, 180_000_000) }),
    },
    { name: 'short secret', value: options({ hmacSecret: new Uint8Array(31) }) },
    { name: 'long secret', value: options({ hmacSecret: new Uint8Array(33) }) },
    { name: 'empty namespace', value: options({ deploymentNamespace: '' }) },
    { name: 'braced namespace', value: options({ deploymentNamespace: 'show{case}' }) },
    { name: 'uppercase namespace', value: options({ deploymentNamespace: 'Showcase' }) },
    {
      name: 'trailing namespace punctuation',
      value: options({ deploymentNamespace: 'showcase-' }),
    },
    { name: 'empty epoch', value: options({ keyEpoch: '' }) },
    { name: 'braced epoch', value: options({ keyEpoch: 'epoch{1}' }) },
    { name: 'uppercase epoch', value: options({ keyEpoch: 'V1' }) },
    { name: 'trailing epoch punctuation', value: options({ keyEpoch: 'v1.' }) },
  ])('rejects $name', ({ value }): void => {
    expectConfigurationFailure(value);
  });

  it('requires exact ordinary frozen options and nested policy records', (): void => {
    const valid = options();
    const mutable = { ...valid };
    const mutablePolicy = { capacity: 300, tokenIntervalMicroseconds: 200_000 };

    expectConfigurationFailure(mutable);
    expectConfigurationFailure(options({ deployment: mutablePolicy }));
    expectConfigurationFailure(Object.freeze({ ...valid, extra: true }));
    expectConfigurationFailure(new Proxy(valid, {}));
  });

  it('accepts exact frozen records regardless of property insertion order', async (): Promise<void> => {
    const reorderedPolicy = Object.freeze({
      tokenIntervalMicroseconds: 200_000,
      capacity: 300,
    });
    const reorderedOptions = Object.freeze({
      presentedCredential: policy(3, 100_000_000),
      network: policy(120, 2_500_000),
      deployment: reorderedPolicy,
      hmacSecret: secret(),
      keyEpoch: '2026.q3',
      deploymentNamespace: 'showcase-in',
    });
    const validAdmission = admission();
    const reorderedAdmission = Object.freeze({
      presentedRefreshCredential: validAdmission.presentedRefreshCredential,
      network: validAdmission.network,
    });
    const { executor } = fakeExecutor();
    const control = createRedisIdentitySessionRefreshCredentialAbuseControl(
      executor,
      reorderedOptions,
    );

    await expect(control.admitSessionRefresh(reorderedAdmission)).resolves.toEqual({
      kind: 'allowed',
    });
  });

  it('requires an ordinary fixed exact-buffer secret and rejects shared, offset, resizable, or subclass views', (): void => {
    const offsetBacking = new ArrayBuffer(64);
    const offset = new Uint8Array(offsetBacking, 16, 32);
    const SharedArrayBufferConstructor = SharedArrayBuffer;
    const shared = new Uint8Array(new SharedArrayBufferConstructor(32));
    class SecretSubclass extends Uint8Array {}
    const subclass = new SecretSubclass(32);
    const proxied = new Proxy(secret(), {});

    for (const candidate of [
      offset,
      shared,
      subclass,
      Buffer.alloc(32),
      resizableSecret(),
      proxied,
    ]) {
      expectConfigurationFailure(options({ hmacSecret: candidate }));
    }
  });

  it('rejects missing or hostile executor capabilities with one fixed internal failure', (): void => {
    for (const executor of [
      null,
      {},
      { execute: 1 },
      new Proxy(
        {
          execute(): undefined {
            return undefined;
          },
        },
        {},
      ),
    ]) {
      const error = captureError(() =>
        createRedisIdentitySessionRefreshCredentialAbuseControl(
          executor as RedisLuaScriptExecutor,
          options(),
        ),
      );
      expectFixedError(error, IdentityCredentialAbuseControlError, ERROR_MESSAGE);
    }
  });
});

describe('Redis Identity infrastructure surface', (): void => {
  it('exports only the production factory at runtime and nothing through the package root', (): void => {
    expect(Reflect.ownKeys(redisInfrastructurePublicApi)).toEqual([
      '__esModule',
      'createRedisIdentitySessionRefreshCredentialAbuseControl',
    ]);
    expect(identityPublicApi).not.toHaveProperty(
      'createRedisIdentitySessionRefreshCredentialAbuseControl',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'RedisIdentitySessionRefreshCredentialAbuseControlOptions',
    );
  });

  it('poisons the stable marker before bucket writes and restores it only as the final write', (): void => {
    const source = REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT_SOURCE;
    const poison = "redis.call('SET', KEYS[1], 'OMS_ABUSE_POISONED_V1')";
    const bucketWrites = 'for index = 1, 3 do';
    const restore = "redis.call('SET', KEYS[1], policy_fingerprint)";
    const poisonIndex = source.indexOf(poison);
    const bucketWriteIndex = source.lastIndexOf(bucketWrites);
    const restoreIndex = source.indexOf(restore);
    const decisionIndex = source.indexOf('if denied then', restoreIndex);

    expect(poisonIndex).toBeGreaterThan(0);
    expect(bucketWriteIndex).toBeGreaterThan(poisonIndex);
    expect(restoreIndex).toBeGreaterThan(bucketWriteIndex);
    expect(decisionIndex).toBeGreaterThan(restoreIndex);
    expect(source.lastIndexOf(restore)).toBe(restoreIndex);
    expect(source.slice(restoreIndex + restore.length, decisionIndex)).not.toContain(
      "redis.call('SET', KEYS[",
    );
    expect(source).not.toContain('NOSCRIPT No matching script. Please use EVAL.');
  });

  it('fails a Redis clock regression before the poison marker or any bucket write', (): void => {
    const source = REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT_SOURCE;
    const regressionCondition = 'if observed_now < last then';
    const regressionFailure = "fail('OMS_ABUSE_TIME_REGRESSION')";
    const poison = "redis.call('SET', KEYS[1], 'OMS_ABUSE_POISONED_V1')";
    const conditionIndex = source.indexOf(regressionCondition);
    const failureIndex = source.indexOf(regressionFailure);
    const poisonIndex = source.indexOf(poison);

    expect(conditionIndex).toBeGreaterThan(0);
    expect(failureIndex).toBeGreaterThan(conditionIndex);
    expect(poisonIndex).toBeGreaterThan(failureIndex);
    expect(source).not.toContain('effective_now');
  });
});

void (undefined as unknown as LeakedSubpathPort);
void (undefined as unknown as LeakedSubpathDecision);
void (undefined as unknown as LeakedRootFactory);
void (undefined as unknown as LeakedRootOptions);
