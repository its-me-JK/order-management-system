import { inspect } from 'node:util';

import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  copyIdentityAccessCredentialDigestBytes,
  copyIdentityRefreshCredentialDigestBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../src/application/identity-session-credential-digest.values';
import {
  InvalidIdentityAccessCredentialDigestError,
  InvalidIdentityRefreshCredentialDigestError,
} from '../src/application/identity-session-credential.errors';

const DIGEST_BYTE_LENGTH = 32;
const REDACTED = '[REDACTED]';

type ErrorClass = abstract new (...arguments_: never[]) => Error;
type IdentityCredentialDigest = IdentityAccessCredentialDigest | IdentityRefreshCredentialDigest;
type RuntimeDigest = Readonly<{
  constructor: new (value: unknown) => object;
  toJSON(): string;
  toString(): string;
  [Symbol.toPrimitive](): string;
}>;
type DigestHarness = Readonly<{
  kind: 'access' | 'refresh';
  ErrorClass: ErrorClass;
  errorName: string;
  errorMessage: string;
  create(value: unknown): IdentityCredentialDigest;
  copy(value: unknown): Uint8Array<ArrayBuffer>;
}>;

function digestBytes(seed = 11): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    { length: DIGEST_BYTE_LENGTH },
    (_unused, index): number => (seed + index * 17) & 0xff,
  );
}

function resizableArrayBuffer(byteLength: number): ArrayBuffer {
  const ResizableArrayBufferConstructor = ArrayBuffer as unknown as new (
    initialByteLength: number,
    options: Readonly<{ maxByteLength: number }>,
  ) => ArrayBuffer;

  return new ResizableArrayBufferConstructor(byteLength, {
    maxByteLength: byteLength * 2,
  });
}

const harnesses = [
  {
    kind: 'access',
    ErrorClass: InvalidIdentityAccessCredentialDigestError,
    errorName: 'InvalidIdentityAccessCredentialDigestError',
    errorMessage: 'Expected a valid Identity access credential digest',
    create: createIdentityAccessCredentialDigestFromBytes,
    copy(value: unknown): Uint8Array<ArrayBuffer> {
      return copyIdentityAccessCredentialDigestBytes(value as IdentityAccessCredentialDigest);
    },
  },
  {
    kind: 'refresh',
    ErrorClass: InvalidIdentityRefreshCredentialDigestError,
    errorName: 'InvalidIdentityRefreshCredentialDigestError',
    errorMessage: 'Expected a valid Identity refresh credential digest',
    create: createIdentityRefreshCredentialDigestFromBytes,
    copy(value: unknown): Uint8Array<ArrayBuffer> {
      return copyIdentityRefreshCredentialDigestBytes(value as IdentityRefreshCredentialDigest);
    },
  },
] as const satisfies readonly DigestHarness[];

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

function expectFixedSafeError(
  operation: () => unknown,
  harness: DigestHarness,
  rejectedValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(harness.ErrorClass);
  expect(error).toMatchObject({
    name: harness.errorName,
    message: harness.errorMessage,
  });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

function expectOrdinaryDigestCopy(
  actual: Uint8Array<ArrayBuffer>,
  expected: Uint8Array<ArrayBuffer>,
): void {
  expect(actual).toBeInstanceOf(Uint8Array);
  expect(Buffer.isBuffer(actual)).toBe(false);
  expect(Object.getPrototypeOf(actual)).toBe(Uint8Array.prototype);
  expect(actual.byteLength).toBe(DIGEST_BYTE_LENGTH);
  expect(actual.byteOffset).toBe(0);
  expect(actual.buffer).toBeInstanceOf(ArrayBuffer);
  expect(Object.getPrototypeOf(actual.buffer)).toBe(ArrayBuffer.prototype);
  expect(actual.buffer.byteLength).toBe(DIGEST_BYTE_LENGTH);
  expect((actual.buffer as ArrayBuffer & Readonly<{ resizable: boolean }>).resizable).toBe(false);
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

describe.each(harnesses)('Identity $kind credential digest', (harness): void => {
  it('accepts an exact ordinary Uint8Array and is idempotent', (): void => {
    const bytes = digestBytes();
    const digest = harness.create(bytes);

    expect(Object.isFrozen(digest)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(digest))).toBe(true);
    expect(Object.isFrozen((digest as unknown as RuntimeDigest).constructor)).toBe(true);
    expect(harness.create(digest)).toBe(digest);
    expectOrdinaryDigestCopy(harness.copy(digest), bytes);
  });

  it('accepts exact offset Uint8Array and ordinary Buffer views', (): void => {
    const expected = digestBytes(29);
    const typedBacking = new ArrayBuffer(80);
    const typedView = new Uint8Array(typedBacking, 13, DIGEST_BYTE_LENGTH);
    typedView.set(expected);

    const bufferBacking = new ArrayBuffer(96);
    const offsetBuffer = Buffer.from(bufferBacking, 23, DIGEST_BYTE_LENGTH);
    offsetBuffer.set(expected);
    const allocatedBuffer = Buffer.from(expected);

    for (const input of [typedView, offsetBuffer, allocatedBuffer]) {
      expectOrdinaryDigestCopy(harness.copy(harness.create(input)), expected);
    }
  });

  it.each([
    ['empty Uint8Array', new Uint8Array(0)],
    ['short Uint8Array', new Uint8Array(DIGEST_BYTE_LENGTH - 1)],
    ['long Uint8Array', new Uint8Array(DIGEST_BYTE_LENGTH + 1)],
    ['short Buffer', Buffer.alloc(DIGEST_BYTE_LENGTH - 1)],
    ['long Buffer', Buffer.alloc(DIGEST_BYTE_LENGTH + 1)],
    ['number array', Array.from(digestBytes())],
    ['hex text', Buffer.from(digestBytes()).toString('hex')],
    ['ArrayBuffer', new ArrayBuffer(DIGEST_BYTE_LENGTH)],
    ['DataView', new DataView(new ArrayBuffer(DIGEST_BYTE_LENGTH))],
    ['Uint8ClampedArray', new Uint8ClampedArray(DIGEST_BYTE_LENGTH)],
    ['Uint16Array', new Uint16Array(DIGEST_BYTE_LENGTH / 2)],
  ] as const)('rejects a %s', (_scenario, input): void => {
    expectFixedSafeError(() => harness.create(input), harness);
  });

  it('rejects a clamped view whose prototype forges Uint8Array instanceof', (): void => {
    const forged = new Uint8ClampedArray(DIGEST_BYTE_LENGTH);
    Object.setPrototypeOf(forged, Uint8Array.prototype);

    expect(forged).toBeInstanceOf(Uint8Array);
    expectFixedSafeError(() => harness.create(forged), harness);
  });

  it('rejects detached views with the fixed kind-specific error', (): void => {
    const bytes = digestBytes();
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });

    expect(bytes.byteLength).toBe(0);
    expectFixedSafeError(() => harness.create(bytes), harness);
  });

  it('rejects resizable and shared views including Buffer views', (): void => {
    const resizableBacking = resizableArrayBuffer(DIGEST_BYTE_LENGTH);
    const sharedBacking = new SharedArrayBuffer(DIGEST_BYTE_LENGTH);
    new Uint8Array(resizableBacking).set(digestBytes());
    new Uint8Array(sharedBacking).set(digestBytes());

    const rejectedInputs = [
      new Uint8Array(resizableBacking),
      Buffer.from(resizableBacking),
      new Uint8Array(sharedBacking),
      Buffer.from(sharedBacking),
    ];

    for (const input of rejectedInputs) {
      expectFixedSafeError(() => harness.create(input), harness);
    }
  });

  it('uses intrinsic buffer facts instead of spoofable own properties', (): void => {
    const sharedView = new Uint8Array(new SharedArrayBuffer(DIGEST_BYTE_LENGTH));
    const resizableView = new Uint8Array(resizableArrayBuffer(DIGEST_BYTE_LENGTH));

    for (const input of [sharedView, resizableView]) {
      Object.defineProperties(input, {
        buffer: { value: new ArrayBuffer(DIGEST_BYTE_LENGTH) },
        byteLength: { value: DIGEST_BYTE_LENGTH },
      });
      expectFixedSafeError(() => harness.create(input), harness);
    }
  });

  it('isolates private storage from both source and extracted-copy mutation', (): void => {
    const source = digestBytes(47);
    const expected = Uint8Array.from(source);
    const digest = harness.create(source);
    source.fill(0xff);

    const firstCopy = harness.copy(digest);
    const secondCopy = harness.copy(digest);
    expect(firstCopy).not.toBe(secondCopy);
    expect(firstCopy.buffer).not.toBe(secondCopy.buffer);
    expectOrdinaryDigestCopy(firstCopy, expected);
    firstCopy.fill(0);
    expectOrdinaryDigestCopy(harness.copy(digest), expected);
  });

  it('redacts inspection and has no own secret-bearing properties', (): void => {
    const bytes = digestBytes(73);
    const secretHex = Buffer.from(bytes).toString('hex');
    const digest = harness.create(bytes);
    const runtime = digest as unknown as RuntimeDigest;
    const coercible: unknown = runtime;
    const clone = structuredClone(digest);

    expect(Object.keys(digest)).toEqual([]);
    expect(Reflect.ownKeys(digest)).toEqual([]);
    expect(Object.getOwnPropertyDescriptors(digest)).toEqual({});
    expect(Object.assign({}, digest)).toEqual({});
    expect(runtime.toJSON()).toBe(REDACTED);
    expect(runtime.toString()).toBe(REDACTED);
    expect(runtime[Symbol.toPrimitive]()).toBe(REDACTED);
    expect(String(coercible)).toBe(REDACTED);
    expect(JSON.stringify(digest)).toBe(JSON.stringify(REDACTED));
    expect(JSON.stringify({ digest })).toBe(`{"digest":"${REDACTED}"}`);
    expect(inspect(digest, { showHidden: true })).not.toContain(secretHex);
    expect(inspect({ digest }, { showHidden: true })).not.toContain(secretHex);
    expect(inspect(clone, { showHidden: true })).not.toContain(secretHex);
    expectFixedSafeError(() => harness.create(clone), harness);
    expectFixedSafeError(() => harness.copy(clone), harness);
  });

  it('validates recovered constructors and rejects subclass construction', (): void => {
    const bytes = digestBytes(101);
    const digest = harness.create(bytes);
    const Constructor = (digest as unknown as RuntimeDigest).constructor;
    const reconstructed = new Constructor(bytes);

    expectOrdinaryDigestCopy(harness.copy(reconstructed), bytes);
    expectFixedSafeError(() => new Constructor('recovered-digest-constructor-secret'), harness, [
      'recovered-digest-constructor-secret',
    ]);

    class ForgedSubclass extends Constructor {}

    expectFixedSafeError(() => new ForgedSubclass(bytes), harness);
  });

  it('rejects forged wrappers, proxies, and revoked proxies', (): void => {
    const digest = harness.create(digestBytes());
    const forged = Object.create(Object.getPrototypeOf(digest) as object) as unknown;
    const wrappedDigest = new Proxy(digest, {});
    const wrappedBytes = new Proxy(digestBytes(), {});
    const revokedDigest = Proxy.revocable(digest, {});
    const revokedBytes = Proxy.revocable(digestBytes(), {});
    revokedDigest.revoke();
    revokedBytes.revoke();

    for (const invalid of [
      forged,
      wrappedDigest,
      wrappedBytes,
      revokedDigest.proxy,
      revokedBytes.proxy,
    ]) {
      expectFixedSafeError(() => harness.create(invalid), harness);
      expectFixedSafeError(() => harness.copy(invalid), harness);
    }
  });

  it('collapses hostile coercion, throwing Proxy traps, and getter failures', (): void => {
    const secret = 'hostile-digest-input-secret';
    let coercionCalls = 0;
    const hostileObject = {
      get buffer(): never {
        throw new Error(secret);
      },
      toJSON(): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
      toString(): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
      valueOf(): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
      [Symbol.toPrimitive](): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
    };
    const throwingProxy = new Proxy(digestBytes(), {
      getPrototypeOf(): never {
        throw new Error(secret);
      },
    });

    expectFixedSafeError(() => harness.create(hostileObject), harness, [secret]);
    expect(coercionCalls).toBe(0);
    expectFixedSafeError(() => harness.create(throwingProxy), harness, [secret]);
  });
});

describe('Identity credential digest namespace separation', (): void => {
  it('rejects authentic wrappers across access and refresh namespaces', (): void => {
    const bytes = digestBytes();
    const access = createIdentityAccessCredentialDigestFromBytes(bytes);
    const refresh = createIdentityRefreshCredentialDigestFromBytes(bytes);

    expectFixedSafeError(
      () => createIdentityAccessCredentialDigestFromBytes(refresh),
      harnesses[0],
    );
    expectFixedSafeError(
      () => createIdentityRefreshCredentialDigestFromBytes(access),
      harnesses[1],
    );
    expectFixedSafeError(
      () =>
        copyIdentityAccessCredentialDigestBytes(
          refresh as unknown as IdentityAccessCredentialDigest,
        ),
      harnesses[0],
    );
    expectFixedSafeError(
      () =>
        copyIdentityRefreshCredentialDigestBytes(
          access as unknown as IdentityRefreshCredentialDigest,
        ),
      harnesses[1],
    );
  });
});

function compileOnlyNominalDigestSeparation(): void {
  const bytes = digestBytes();
  const access = createIdentityAccessCredentialDigestFromBytes(bytes);
  const refresh = createIdentityRefreshCredentialDigestFromBytes(bytes);

  // @ts-expect-error Access and refresh digest brands are intentionally incompatible.
  const invalidAccess: IdentityAccessCredentialDigest = refresh;
  // @ts-expect-error Access and refresh digest brands are intentionally incompatible.
  const invalidRefresh: IdentityRefreshCredentialDigest = access;
  void invalidAccess;
  void invalidRefresh;
}
void compileOnlyNominalDigestSeparation;
