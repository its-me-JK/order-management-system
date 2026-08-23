import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  copyIdentityAccessCredentialDigestBytes,
  copyIdentityRefreshCredentialDigestBytes,
} from '../src/application/identity-session-credential-digest.values';
import {
  IdentitySessionCredentialCryptoUnavailableError,
  InvalidIdentityAccessCredentialWireValueError,
  InvalidIdentityRefreshCredentialWireValueError,
} from '../src/application/identity-session-credential.errors';
import {
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
  serializeIdentityAccessCredentialWireValue,
  serializeIdentityRefreshCredentialWireValue,
  type IdentityAccessCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from '../src/application/identity-session-credential-wire.values';
import {
  createNodeIdentitySessionCredentialCrypto,
  createNodeIdentitySessionCredentialCryptoWithPrimitives,
  type NodeIdentitySessionCredentialCryptoPrimitives,
} from '../src/infrastructure/cryptography/node-identity-session-credential-crypto';
import type {
  // @ts-expect-error The deterministic primitive seam is not part of the public subpath.
  createNodeIdentitySessionCredentialCryptoWithPrimitives as LeakedSubpathCryptoFactory,
  // @ts-expect-error The primitive-provider contract is not part of the public subpath.
  NodeIdentitySessionCredentialCryptoPrimitives as LeakedSubpathCryptoPrimitives,
} from '../src/infrastructure/cryptography';
import * as identityCryptographyPublicApi from '../src/infrastructure/cryptography';
import type {
  // @ts-expect-error The Node production factory belongs to its infrastructure subpath.
  createNodeIdentitySessionCredentialCrypto as LeakedRootCryptoFactory,
  // @ts-expect-error The deterministic primitive seam is not part of the package root.
  NodeIdentitySessionCredentialCryptoPrimitives as LeakedRootCryptoPrimitives,
} from '../src';
import * as identityPublicApi from '../src';

const BYTE_LENGTH = 32;
const ACCESS_SPECIAL_WIRE = 'oms_at_v1_-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_s';
const REFRESH_SPECIAL_WIRE = 'oms_rt_v1__v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v4';
const ACCESS_SPECIAL_DIGEST_HEX =
  '6bd32b8a680e4720175a860895ff9f9a421baa097dc01e74e11bca05f77b7324';
const REFRESH_SPECIAL_DIGEST_HEX =
  'caf2f6c333d4305d6c0ce05cb60e509a62f3accf5f0b8ecd04249d49403fa53a';
const ZERO_PAYLOAD = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SEQUENTIAL_PAYLOAD = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const SEQUENTIAL_ACCESS_WIRE = `oms_at_v1_${SEQUENTIAL_PAYLOAD}`;
const SEQUENTIAL_REFRESH_WIRE = `oms_rt_v1_${SEQUENTIAL_PAYLOAD}`;
const SEQUENTIAL_ACCESS_DIGEST_HEX =
  'a8bf50abb8f01d36cf08521b1cb1b7bbe1638a0ab17d486a781416480496ff75';
const SEQUENTIAL_REFRESH_DIGEST_HEX =
  '324babac885979035f8ac3a74ef9b2b9732215a504f95b0916944c019a005d13';
const CRYPTO_UNAVAILABLE_MESSAGE =
  'Identity session credential cryptography is temporarily unavailable';
const requireFromTest = createRequire(__filename);

type RandomBytesPrimitive = NodeIdentitySessionCredentialCryptoPrimitives['randomBytes'];
type Sha256AsciiPrimitive = NodeIdentitySessionCredentialCryptoPrimitives['sha256Ascii'];
type ErrorClass = abstract new (...arguments_: never[]) => Error;

function filledBytes(fill: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(BYTE_LENGTH);
  value.fill(fill);
  return value;
}

function sequentialBytes(start: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    { length: BYTE_LENGTH },
    (_unused, index): number => (start + index) & 0xff,
  );
}

function bytesFromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

function sha256Ascii(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHash('sha256').update(value, 'ascii').digest());
}

function hex(value: Uint8Array<ArrayBuffer>): string {
  return Buffer.from(value).toString('hex');
}

function allBytesAre(value: Uint8Array, expected: number): boolean {
  return value.every((byte) => byte === expected);
}

function primitives(
  randomBytes: RandomBytesPrimitive,
  hash: Sha256AsciiPrimitive,
): NodeIdentitySessionCredentialCryptoPrimitives {
  return { randomBytes, sha256Ascii: hash };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function spoofTypedArrayFacts(value: object): void {
  Object.defineProperty(value, 'buffer', {
    configurable: true,
    value: new ArrayBuffer(BYTE_LENGTH),
  });
  Object.defineProperty(value, 'byteLength', {
    configurable: true,
    value: BYTE_LENGTH,
  });
  Object.defineProperty(value, Symbol.toStringTag, {
    configurable: true,
    value: 'Uint8Array',
  });
}

async function captureAsyncError(operation: () => Promise<unknown>): Promise<Error> {
  const pending = operation();
  expect(pending).toBeInstanceOf(Promise);

  try {
    await pending;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to reject with an Error');
}

function captureSynchronousError(operation: () => void): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error synchronously');
}

async function expectFixedAsyncError(
  operation: () => Promise<unknown>,
  ExpectedError: ErrorClass,
  expectedName: string,
  expectedMessage: string,
  rejectedValues: readonly string[] = [],
): Promise<Error> {
  const error = await captureAsyncError(operation);

  expect(error).toBeInstanceOf(ExpectedError);
  expect(error).toMatchObject({ name: expectedName, message: expectedMessage });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const value of rejectedValues) {
    expect(String(error)).not.toContain(value);
    expect(JSON.stringify(error)).not.toContain(value);
    expect(error.stack ?? '').not.toContain(value);
  }

  return error;
}

async function expectUnavailable(
  operation: () => Promise<unknown>,
  rejectedValues: readonly string[] = [],
): Promise<Error> {
  return expectFixedAsyncError(
    operation,
    IdentitySessionCredentialCryptoUnavailableError,
    'IdentitySessionCredentialCryptoUnavailableError',
    CRYPTO_UNAVAILABLE_MESSAGE,
    rejectedValues,
  );
}

function createDeferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve): void => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T): void {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise was not initialized');
      }

      resolvePromise(value);
    },
  };
}

describe('Node Identity session-credential cryptography vectors', (): void => {
  it('generates the hard-coded Base64url and full-wire SHA-256 vectors', async (): Promise<void> => {
    const accessSource = filledBytes(0xfb);
    const refreshSource = filledBytes(0xfe);
    const accessDigestSource = bytesFromHex(ACCESS_SPECIAL_DIGEST_HEX);
    const refreshDigestSource = bytesFromHex(REFRESH_SPECIAL_DIGEST_HEX);
    const trace: string[] = [];
    let randomCall = 0;
    let hashCall = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (byteLength): Promise<unknown> => {
          randomCall += 1;
          trace.push(`random:${String(randomCall)}:${String(byteLength)}`);
          return Promise.resolve(randomCall === 1 ? accessSource : refreshSource);
        },
        (wireValue): unknown => {
          hashCall += 1;
          trace.push(`hash:${String(hashCall)}:${wireValue}`);
          if (wireValue === ACCESS_SPECIAL_WIRE) {
            return accessDigestSource;
          }
          if (wireValue === REFRESH_SPECIAL_WIRE) {
            return refreshDigestSource;
          }

          throw new Error('The adapter hashed a non-canonical input');
        },
      ),
    );

    const candidates = await crypto.generateSessionCredentialCandidates();

    expect(trace).toEqual([
      'random:1:32',
      'random:2:32',
      `hash:1:${ACCESS_SPECIAL_WIRE}`,
      `hash:2:${REFRESH_SPECIAL_WIRE}`,
    ]);
    expect(serializeIdentityAccessCredentialWireValue(candidates.access.wireValue)).toBe(
      ACCESS_SPECIAL_WIRE,
    );
    expect(serializeIdentityRefreshCredentialWireValue(candidates.refresh.wireValue)).toBe(
      REFRESH_SPECIAL_WIRE,
    );
    expect(hex(copyIdentityAccessCredentialDigestBytes(candidates.access.digest))).toBe(
      ACCESS_SPECIAL_DIGEST_HEX,
    );
    expect(hex(copyIdentityRefreshCredentialDigestBytes(candidates.refresh.digest))).toBe(
      REFRESH_SPECIAL_DIGEST_HEX,
    );
    expect(ACCESS_SPECIAL_WIRE).toHaveLength(53);
    expect(REFRESH_SPECIAL_WIRE).toHaveLength(53);
    expect(ACCESS_SPECIAL_WIRE).not.toContain('=');
    expect(REFRESH_SPECIAL_WIRE).not.toContain('=');
    expect(allBytesAre(accessSource, 0)).toBe(true);
    expect(allBytesAre(refreshSource, 0)).toBe(true);
    expect(allBytesAre(accessDigestSource, 0)).toBe(true);
    expect(allBytesAre(refreshDigestSource, 0)).toBe(true);
  });

  it('accepts one valid all-zero draw when the sibling entropy is distinct', async (): Promise<void> => {
    const zeroAccessSource = filledBytes(0);
    const distinctRefreshSource = filledBytes(1);
    let randomCalls = 0;
    let hashCalls = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          randomCalls += 1;
          return Promise.resolve(randomCalls === 1 ? zeroAccessSource : distinctRefreshSource);
        },
        (wireValue): unknown => {
          hashCalls += 1;
          return sha256Ascii(wireValue);
        },
      ),
    );

    const candidates = await crypto.generateSessionCredentialCandidates();
    const accessWire = serializeIdentityAccessCredentialWireValue(candidates.access.wireValue);
    const refreshWire = serializeIdentityRefreshCredentialWireValue(candidates.refresh.wireValue);

    expect(accessWire).toBe(`oms_at_v1_${ZERO_PAYLOAD}`);
    expect(refreshWire).not.toBe(`oms_rt_v1_${ZERO_PAYLOAD}`);
    expect(randomCalls).toBe(2);
    expect(hashCalls).toBe(2);
    expect(allBytesAre(distinctRefreshSource, 0)).toBe(true);
  });

  it('awaits two sequential 32-byte draws and cleans the first before requesting the second', async (): Promise<void> => {
    const first = createDeferred<unknown>();
    const second = createDeferred<unknown>();
    const secondRequested = createDeferred<undefined>();
    const accessSource = sequentialBytes(0);
    const refreshSource = sequentialBytes(32);
    const trace: string[] = [];
    let calls = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (byteLength): Promise<unknown> => {
          calls += 1;
          trace.push(`random:${String(calls)}:${String(byteLength)}`);
          if (calls === 1) {
            return first.promise;
          }

          expect(allBytesAre(accessSource, 0)).toBe(true);
          secondRequested.resolve(undefined);
          return second.promise;
        },
        (wireValue): unknown => {
          trace.push(`hash:${wireValue}`);
          return sha256Ascii(wireValue);
        },
      ),
    );

    const pendingCandidates = crypto.generateSessionCredentialCandidates();
    expect(trace).toEqual(['random:1:32']);

    first.resolve(accessSource);
    await secondRequested.promise;
    expect(trace).toEqual(['random:1:32', 'random:2:32']);

    second.resolve(refreshSource);
    const candidates = await pendingCandidates;

    expect(trace).toEqual([
      'random:1:32',
      'random:2:32',
      `hash:${SEQUENTIAL_ACCESS_WIRE}`,
      'hash:oms_rt_v1_ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8',
    ]);
    expect(allBytesAre(refreshSource, 0)).toBe(true);
    expect(serializeIdentityAccessCredentialWireValue(candidates.access.wireValue)).toBe(
      SEQUENTIAL_ACCESS_WIRE,
    );
  });

  it('accepts sequential reuse of one provider view only after each prior value is cleaned', async (): Promise<void> => {
    const reusable = new Uint8Array(BYTE_LENGTH);
    const accessDigest = bytesFromHex(ACCESS_SPECIAL_DIGEST_HEX);
    const refreshDigest = bytesFromHex(REFRESH_SPECIAL_DIGEST_HEX);
    let randomCall = 0;
    let hashCall = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          expect(allBytesAre(reusable, 0)).toBe(true);
          randomCall += 1;
          reusable.fill(randomCall === 1 ? 0xfb : 0xfe);
          return Promise.resolve(reusable);
        },
        (): unknown => {
          expect(allBytesAre(reusable, 0)).toBe(true);
          hashCall += 1;
          reusable.set(hashCall === 1 ? accessDigest : refreshDigest);
          return reusable;
        },
      ),
    );

    const candidates = await crypto.generateSessionCredentialCandidates();

    expect(randomCall).toBe(2);
    expect(hashCall).toBe(2);
    expect(allBytesAre(reusable, 0)).toBe(true);
    expect(serializeIdentityAccessCredentialWireValue(candidates.access.wireValue)).toBe(
      ACCESS_SPECIAL_WIRE,
    );
    expect(serializeIdentityRefreshCredentialWireValue(candidates.refresh.wireValue)).toBe(
      REFRESH_SPECIAL_WIRE,
    );
  });

  it('accepts offset views, copies only visible bytes, and wipes only those ranges', async (): Promise<void> => {
    const accessBacking = new ArrayBuffer(66);
    const refreshBacking = new ArrayBuffer(70);
    const accessSource = new Uint8Array(accessBacking, 1, BYTE_LENGTH);
    const refreshSource = new Uint8Array(refreshBacking, 19, BYTE_LENGTH);
    new Uint8Array(accessBacking).fill(0x5a);
    new Uint8Array(refreshBacking).fill(0xa5);
    accessSource.fill(0xfb);
    refreshSource.fill(0xfe);
    Object.defineProperty(accessSource, 'fill', {
      value(): never {
        throw new Error('spoofed source fill must not run');
      },
    });
    let call = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          call += 1;
          return Promise.resolve(call === 1 ? accessSource : refreshSource);
        },
        (wireValue): unknown => sha256Ascii(wireValue),
      ),
    );

    await crypto.generateSessionCredentialCandidates();

    expect(Array.from(accessSource)).toEqual(Array(BYTE_LENGTH).fill(0));
    expect(Array.from(refreshSource)).toEqual(Array(BYTE_LENGTH).fill(0));
    expect(new Uint8Array(accessBacking)[0]).toBe(0x5a);
    expect(new Uint8Array(accessBacking).at(-1)).toBe(0x5a);
    expect(new Uint8Array(refreshBacking)[0]).toBe(0xa5);
    expect(new Uint8Array(refreshBacking).at(-1)).toBe(0xa5);
  });
});

describe('Node Identity session-credential provider failures', (): void => {
  const malformedByteResults = (): readonly (readonly [string, unknown])[] => {
    const detached = filledBytes(7);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const resizable = resizableArrayBuffer(BYTE_LENGTH);
    const clampedForgery = new Uint8ClampedArray(BYTE_LENGTH);
    Object.setPrototypeOf(clampedForgery, Uint8Array.prototype);
    const spoofedClamped = new Uint8ClampedArray(BYTE_LENGTH);
    const spoofedShared = new Uint8Array(new SharedArrayBuffer(BYTE_LENGTH));
    const spoofedResizable = new Uint8Array(resizableArrayBuffer(BYTE_LENGTH));
    spoofTypedArrayFacts(spoofedClamped);
    spoofTypedArrayFacts(spoofedShared);
    spoofTypedArrayFacts(spoofedResizable);

    return [
      ['null', null],
      ['plain array', Array(BYTE_LENGTH).fill(1)],
      ['ArrayBuffer', new ArrayBuffer(BYTE_LENGTH)],
      ['DataView', new DataView(new ArrayBuffer(BYTE_LENGTH))],
      ['wrong typed-array kind', new Uint8ClampedArray(BYTE_LENGTH)],
      ['prototype-forged typed array', clampedForgery],
      ['property-spoofed wrong typed-array kind', spoofedClamped],
      ['proxied bytes', new Proxy(filledBytes(1), {})],
      ['short bytes', new Uint8Array(BYTE_LENGTH - 1)],
      ['long bytes', new Uint8Array(BYTE_LENGTH + 1)],
      ['detached bytes', detached],
      ['shared bytes', new Uint8Array(new SharedArrayBuffer(BYTE_LENGTH))],
      ['resizable bytes', new Uint8Array(resizable)],
      ['property-spoofed shared bytes', spoofedShared],
      ['property-spoofed resizable bytes', spoofedResizable],
    ];
  };

  it.each(malformedByteResults())(
    'rejects a malformed first entropy result: %s',
    async (_scenario, malformed): Promise<void> => {
      let randomCalls = 0;
      let hashCalls = 0;
      const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
        primitives(
          (): Promise<unknown> => {
            randomCalls += 1;
            return Promise.resolve(malformed);
          },
          (): unknown => {
            hashCalls += 1;
            return filledBytes(1);
          },
        ),
      );

      await expectUnavailable(() => crypto.generateSessionCredentialCandidates());
      expect(randomCalls).toBe(1);
      expect(hashCalls).toBe(0);
    },
  );

  it('stops after a rejected first or second entropy call without retry or hash work', async (): Promise<void> => {
    const secret = 'entropy-provider-secret';
    let firstFailureCalls = 0;
    const firstFailure = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          firstFailureCalls += 1;
          return Promise.reject(new Error(secret));
        },
        (): unknown => filledBytes(1),
      ),
    );

    await expectUnavailable(() => firstFailure.generateSessionCredentialCandidates(), [secret]);
    expect(firstFailureCalls).toBe(1);

    const accessSource = filledBytes(0xfb);
    let secondFailureCalls = 0;
    let hashCalls = 0;
    const secondFailure = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          secondFailureCalls += 1;
          if (secondFailureCalls === 1) {
            return Promise.resolve(accessSource);
          }

          return Promise.reject(new Error(secret));
        },
        (): unknown => {
          hashCalls += 1;
          return filledBytes(1);
        },
      ),
    );

    await expectUnavailable(() => secondFailure.generateSessionCredentialCandidates(), [secret]);
    expect(secondFailureCalls).toBe(2);
    expect(hashCalls).toBe(0);
    expect(allBytesAre(accessSource, 0)).toBe(true);
  });

  it('creates a fresh unavailable error for each failure', async (): Promise<void> => {
    const secret = 'reused-provider-error-secret';
    const providerError = new Error(secret);
    let randomCalls = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          randomCalls += 1;
          return Promise.reject(providerError);
        },
        (): unknown => filledBytes(1),
      ),
    );

    const first = await expectUnavailable(
      () => crypto.generateSessionCredentialCandidates(),
      [secret],
    );
    first.name = 'MutatedFirstError';
    first.message = 'mutated-first-error-message';
    const second = await expectUnavailable(
      () => crypto.generateSessionCredentialCandidates(),
      [secret, first.message],
    );

    expect(second).not.toBe(first);
    expect(second).not.toBe(providerError);
    expect(randomCalls).toBe(2);
  });

  it('continues bounded cleanup after a wipe failure and aborts later provider work', async (): Promise<void> => {
    type UnknownReflectApply = (
      target: (...arguments_: unknown[]) => unknown,
      thisArgument: unknown,
      argumentsList: ArrayLike<unknown>,
    ) => unknown;

    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const intrinsicFill: unknown = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      'fill',
    )?.value;
    const reflectApplyDescriptor = Object.getOwnPropertyDescriptor(Reflect, 'apply');

    if (
      typeof intrinsicFill !== 'function' ||
      reflectApplyDescriptor === undefined ||
      typeof reflectApplyDescriptor.value !== 'function'
    ) {
      throw new Error('Required cleanup intrinsics are unavailable in the pinned Node runtime');
    }

    const originalReflectApply = reflectApplyDescriptor.value as UnknownReflectApply;
    const acceptedSource = filledBytes(0x6c);
    let cleanupAttempts = 0;
    let randomCalls = 0;
    let hashCalls = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          randomCalls += 1;
          return Promise.resolve(acceptedSource);
        },
        (): unknown => {
          hashCalls += 1;
          return filledBytes(1);
        },
      ),
    );

    Object.defineProperty(Reflect, 'apply', {
      ...reflectApplyDescriptor,
      value(target: unknown, thisArgument: unknown, argumentsList: ArrayLike<unknown>): unknown {
        if (target === intrinsicFill) {
          cleanupAttempts += 1;

          if (cleanupAttempts === 1) {
            throw new Error('simulated bounded wipe failure');
          }
        }

        if (typeof target !== 'function') {
          throw new TypeError('Reflect.apply target must be callable');
        }

        return originalReflectApply(
          target as (...arguments_: unknown[]) => unknown,
          thisArgument,
          argumentsList,
        );
      },
    });

    try {
      await expectUnavailable(
        () => crypto.generateSessionCredentialCandidates(),
        ['simulated bounded wipe failure'],
      );
      expect(cleanupAttempts).toBe(2);
      expect(randomCalls).toBe(1);
      expect(hashCalls).toBe(0);
      expect(allBytesAre(acceptedSource, 0x6c)).toBe(true);
    } finally {
      Object.defineProperty(Reflect, 'apply', reflectApplyDescriptor);
      acceptedSource.fill(0);
    }
  });

  it('rejects a malformed second entropy result after cleaning the accepted first result', async (): Promise<void> => {
    const accessSource = filledBytes(0xfb);
    const shortRefreshSource = new Uint8Array(BYTE_LENGTH - 1);
    let randomCalls = 0;
    let hashCalls = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          randomCalls += 1;
          return Promise.resolve(randomCalls === 1 ? accessSource : shortRefreshSource);
        },
        (): unknown => {
          hashCalls += 1;
          return filledBytes(1);
        },
      ),
    );

    await expectUnavailable(() => crypto.generateSessionCredentialCandidates());
    expect(randomCalls).toBe(2);
    expect(hashCalls).toBe(0);
    expect(allBytesAre(accessSource, 0)).toBe(true);
  });

  it('rejects malformed hash output, cleans prior accepted values, and stops before hash two', async (): Promise<void> => {
    for (const [, malformed] of malformedByteResults()) {
      const accessSource = filledBytes(0xfb);
      const refreshSource = filledBytes(0xfe);
      let randomCalls = 0;
      let hashCalls = 0;
      const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
        primitives(
          (): Promise<unknown> => {
            randomCalls += 1;
            return Promise.resolve(randomCalls === 1 ? accessSource : refreshSource);
          },
          (): unknown => {
            hashCalls += 1;
            return malformed;
          },
        ),
      );

      await expectUnavailable(() => crypto.generateSessionCredentialCandidates());
      expect(randomCalls).toBe(2);
      expect(hashCalls).toBe(1);
      expect(allBytesAre(accessSource, 0)).toBe(true);
      expect(allBytesAre(refreshSource, 0)).toBe(true);
    }
  });

  it('cleans the first digest and stops after a second hash failure', async (): Promise<void> => {
    const secret = 'second-hash-provider-secret';
    const accessDigestSource = bytesFromHex(ACCESS_SPECIAL_DIGEST_HEX);
    let randomCalls = 0;
    let hashCalls = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          randomCalls += 1;
          return Promise.resolve(filledBytes(randomCalls === 1 ? 0xfb : 0xfe));
        },
        (): unknown => {
          hashCalls += 1;
          if (hashCalls === 1) {
            return accessDigestSource;
          }

          throw new Error(secret);
        },
      ),
    );

    await expectUnavailable(() => crypto.generateSessionCredentialCandidates(), [secret]);
    expect(randomCalls).toBe(2);
    expect(hashCalls).toBe(2);
    expect(allBytesAre(accessDigestSource, 0)).toBe(true);
  });

  it('does not redraw or retry when entropy or digest correlation fails', async (): Promise<void> => {
    let equalEntropyCalls = 0;
    let equalEntropyHashCalls = 0;
    const equalEntropy = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          equalEntropyCalls += 1;
          return Promise.resolve(filledBytes(0x71));
        },
        (wireValue): unknown => {
          equalEntropyHashCalls += 1;
          return sha256Ascii(wireValue);
        },
      ),
    );

    await expectUnavailable(() => equalEntropy.generateSessionCredentialCandidates());
    expect(equalEntropyCalls).toBe(2);
    expect(equalEntropyHashCalls).toBe(2);

    let equalDigestRandomCalls = 0;
    let equalDigestHashCalls = 0;
    const equalDigest = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => {
          equalDigestRandomCalls += 1;
          return Promise.resolve(filledBytes(equalDigestRandomCalls === 1 ? 0xfb : 0xfe));
        },
        (): unknown => {
          equalDigestHashCalls += 1;
          return filledBytes(0x39);
        },
      ),
    );

    await expectUnavailable(() => equalDigest.generateSessionCredentialCandidates());
    expect(equalDigestRandomCalls).toBe(2);
    expect(equalDigestHashCalls).toBe(2);
  });
});

describe('Node Identity presented-credential hashing', (): void => {
  it('hashes the complete namespace-prefixed wire values using hard-coded vectors', async (): Promise<void> => {
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => Promise.resolve(filledBytes(1)),
        (wireValue): unknown => {
          if (wireValue === SEQUENTIAL_ACCESS_WIRE) {
            return bytesFromHex(SEQUENTIAL_ACCESS_DIGEST_HEX);
          }
          if (wireValue === SEQUENTIAL_REFRESH_WIRE) {
            return bytesFromHex(SEQUENTIAL_REFRESH_DIGEST_HEX);
          }

          throw new Error('unexpected hash input');
        },
      ),
    );
    const access = parseIdentityAccessCredentialWireValue(SEQUENTIAL_ACCESS_WIRE);
    const refresh = parseIdentityRefreshCredentialWireValue(SEQUENTIAL_REFRESH_WIRE);

    expect(
      hex(copyIdentityAccessCredentialDigestBytes(await crypto.digestAccessCredential(access))),
    ).toBe(SEQUENTIAL_ACCESS_DIGEST_HEX);
    expect(
      hex(copyIdentityRefreshCredentialDigestBytes(await crypto.digestRefreshCredential(refresh))),
    ).toBe(SEQUENTIAL_REFRESH_DIGEST_HEX);
    expect(SEQUENTIAL_ACCESS_DIGEST_HEX).not.toBe(SEQUENTIAL_REFRESH_DIGEST_HEX);
  });

  it('validates target-kind wire identity before invoking a failing hash provider', async (): Promise<void> => {
    const access = parseIdentityAccessCredentialWireValue(SEQUENTIAL_ACCESS_WIRE);
    const refresh = parseIdentityRefreshCredentialWireValue(SEQUENTIAL_REFRESH_WIRE);
    const forgedAccess = Object.create(Object.getPrototypeOf(access) as object) as unknown;
    const forgedRefresh = Object.create(Object.getPrototypeOf(refresh) as object) as unknown;
    const proxiedAccess = new Proxy(access, {});
    const proxiedRefresh = new Proxy(refresh, {});
    const secret = 'hash-must-not-run-secret';
    let hashCalls = 0;
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(
      primitives(
        (): Promise<unknown> => Promise.resolve(filledBytes(1)),
        (): never => {
          hashCalls += 1;
          throw new Error(secret);
        },
      ),
    );

    for (const invalid of [SEQUENTIAL_ACCESS_WIRE, refresh, forgedAccess, proxiedAccess]) {
      await expectFixedAsyncError(
        () => crypto.digestAccessCredential(invalid as IdentityAccessCredentialWireValue),
        InvalidIdentityAccessCredentialWireValueError,
        'InvalidIdentityAccessCredentialWireValueError',
        'Expected a canonical Identity access credential wire value',
        [SEQUENTIAL_ACCESS_WIRE],
      );
    }

    for (const invalid of [SEQUENTIAL_REFRESH_WIRE, access, forgedRefresh, proxiedRefresh]) {
      await expectFixedAsyncError(
        () => crypto.digestRefreshCredential(invalid as IdentityRefreshCredentialWireValue),
        InvalidIdentityRefreshCredentialWireValueError,
        'InvalidIdentityRefreshCredentialWireValueError',
        'Expected a canonical Identity refresh credential wire value',
        [SEQUENTIAL_REFRESH_WIRE],
      );
    }

    expect(hashCalls).toBe(0);
    await expectUnavailable(() => crypto.digestAccessCredential(access), [secret]);
    await expectUnavailable(() => crypto.digestRefreshCredential(refresh), [secret]);
    expect(hashCalls).toBe(2);
  });
});

describe('Node Identity cryptography construction and real provider', (): void => {
  it('validates and copies the exact internal primitive seam', async (): Promise<void> => {
    const mutablePrimitives: {
      randomBytes: RandomBytesPrimitive;
      sha256Ascii: Sha256AsciiPrimitive;
    } = {
      randomBytes(): Promise<unknown> {
        return Promise.resolve(filledBytes(1));
      },
      sha256Ascii,
    };
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(mutablePrimitives);
    mutablePrimitives.sha256Ascii = (): never => {
      throw new Error('mutated primitive reference');
    };
    const access = parseIdentityAccessCredentialWireValue(SEQUENTIAL_ACCESS_WIRE);

    expect(
      hex(copyIdentityAccessCredentialDigestBytes(await crypto.digestAccessCredential(access))),
    ).toBe(SEQUENTIAL_ACCESS_DIGEST_HEX);

    for (const invalid of [
      null,
      {},
      { randomBytes: (): Promise<unknown> => Promise.resolve(filledBytes(1)) },
      { sha256Ascii },
      { randomBytes: 1, sha256Ascii },
      {
        randomBytes: (): Promise<unknown> => Promise.resolve(filledBytes(1)),
        sha256Ascii: 1,
      },
      {
        randomBytes: (): Promise<unknown> => Promise.resolve(filledBytes(1)),
        sha256Ascii,
        extra: true,
      },
    ]) {
      expect(() => createNodeIdentitySessionCredentialCryptoWithPrimitives(invalid)).toThrow(
        IdentitySessionCredentialCryptoUnavailableError,
      );
    }
  });

  it('seals construction and exports only the production factory from its subpath', (): void => {
    const validPrimitives = primitives(
      (): Promise<unknown> => Promise.resolve(filledBytes(1)),
      sha256Ascii,
    );
    const crypto = createNodeIdentitySessionCredentialCryptoWithPrimitives(validPrimitives);
    const runtime = crypto as unknown as Readonly<{ constructor: unknown }>;
    const recoveredConstructor = runtime.constructor;
    const packageManifest: unknown = requireFromTest('../package.json');

    if (!isRecord(packageManifest) || !isRecord(packageManifest['exports'])) {
      throw new Error('Identity package exports are not represented by an object');
    }

    if (typeof recoveredConstructor !== 'function') {
      throw new Error('Expected the adapter runtime constructor to be callable');
    }

    for (const argumentsList of [
      [validPrimitives],
      [undefined, validPrimitives],
      [Object.freeze({}), validPrimitives],
      [Symbol('guessed-construction-capability'), validPrimitives],
    ]) {
      const error = captureSynchronousError((): void => {
        Reflect.construct(recoveredConstructor, argumentsList);
      });

      expect(error).toBeInstanceOf(IdentitySessionCredentialCryptoUnavailableError);
      expect(error).toMatchObject({
        name: 'IdentitySessionCredentialCryptoUnavailableError',
        message: CRYPTO_UNAVAILABLE_MESSAGE,
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    }

    expect(identityPublicApi).not.toHaveProperty('createNodeIdentitySessionCredentialCrypto');
    expect(identityPublicApi).not.toHaveProperty(
      'createNodeIdentitySessionCredentialCryptoWithPrimitives',
    );
    expect(Object.keys(identityCryptographyPublicApi)).toEqual([
      'createNodeIdentitySessionCredentialCrypto',
    ]);
    expect(identityCryptographyPublicApi.createNodeIdentitySessionCredentialCrypto).toBe(
      createNodeIdentitySessionCredentialCrypto,
    );
    expect(identityCryptographyPublicApi).not.toHaveProperty(
      'createNodeIdentitySessionCredentialCryptoWithPrimitives',
    );
    expect(identityCryptographyPublicApi).not.toHaveProperty(
      'NodeIdentitySessionCredentialCryptoPrimitives',
    );
    expect(Reflect.ownKeys(packageManifest['exports'])).toEqual([
      '.',
      './infrastructure/prisma',
      './infrastructure/cryptography',
      './infrastructure/identifiers',
    ]);
    expect(Object.isFrozen(crypto)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(crypto))).toBe(true);
    expect(Object.isFrozen(recoveredConstructor)).toBe(true);
    expect(Object.keys(crypto)).toEqual([]);
    expect(Reflect.ownKeys(crypto)).toEqual([]);
  });

  it('retains module-evaluation snapshots of the Node crypto functions', async (): Promise<void> => {
    const nodeCryptoModule: unknown = requireFromTest('node:crypto');

    if (!isRecord(nodeCryptoModule)) {
      throw new Error('Expected node:crypto to expose a CommonJS module object');
    }

    const randomBytesDescriptor = Object.getOwnPropertyDescriptor(nodeCryptoModule, 'randomBytes');
    const createHashDescriptor = Object.getOwnPropertyDescriptor(nodeCryptoModule, 'createHash');

    if (
      randomBytesDescriptor === undefined ||
      createHashDescriptor === undefined ||
      randomBytesDescriptor.configurable !== true ||
      createHashDescriptor.configurable !== true
    ) {
      throw new Error('Expected mutable node:crypto export descriptors in the pinned Node runtime');
    }

    let replacedRandomBytesCalls = 0;
    let replacedCreateHashCalls = 0;

    try {
      Object.defineProperty(nodeCryptoModule, 'randomBytes', {
        ...randomBytesDescriptor,
        value(): never {
          replacedRandomBytesCalls += 1;
          throw new Error('mutated Node randomBytes export');
        },
      });
      Object.defineProperty(nodeCryptoModule, 'createHash', {
        ...createHashDescriptor,
        value(): never {
          replacedCreateHashCalls += 1;
          throw new Error('mutated Node createHash export');
        },
      });

      const crypto = createNodeIdentitySessionCredentialCrypto();
      const candidates = await crypto.generateSessionCredentialCandidates();

      expect(Object.isFrozen(candidates)).toBe(true);
      expect(replacedRandomBytesCalls).toBe(0);
      expect(replacedCreateHashCalls).toBe(0);
    } finally {
      Object.defineProperty(nodeCryptoModule, 'randomBytes', randomBytesDescriptor);
      Object.defineProperty(nodeCryptoModule, 'createHash', createHashDescriptor);
    }
  });

  it('uses real Node SHA-256 for the fixed vectors', async (): Promise<void> => {
    const crypto = createNodeIdentitySessionCredentialCrypto();
    const access = parseIdentityAccessCredentialWireValue(SEQUENTIAL_ACCESS_WIRE);
    const refresh = parseIdentityRefreshCredentialWireValue(SEQUENTIAL_REFRESH_WIRE);

    expect(
      hex(copyIdentityAccessCredentialDigestBytes(await crypto.digestAccessCredential(access))),
    ).toBe(SEQUENTIAL_ACCESS_DIGEST_HEX);
    expect(
      hex(copyIdentityRefreshCredentialDigestBytes(await crypto.digestRefreshCredential(refresh))),
    ).toBe(SEQUENTIAL_REFRESH_DIGEST_HEX);
  });

  it('generates one canonical, complete pair with the real Node provider', async (): Promise<void> => {
    const crypto = createNodeIdentitySessionCredentialCrypto();
    const candidates = await crypto.generateSessionCredentialCandidates();
    const accessWire = serializeIdentityAccessCredentialWireValue(candidates.access.wireValue);
    const refreshWire = serializeIdentityRefreshCredentialWireValue(candidates.refresh.wireValue);
    const expectedAccessDigest = await crypto.digestAccessCredential(candidates.access.wireValue);
    const expectedRefreshDigest = await crypto.digestRefreshCredential(
      candidates.refresh.wireValue,
    );

    expect(accessWire).toMatch(/^oms_at_v1_[A-Za-z0-9_-]{43}$/u);
    expect(refreshWire).toMatch(/^oms_rt_v1_[A-Za-z0-9_-]{43}$/u);
    expect(accessWire.slice(10)).not.toBe(refreshWire.slice(10));
    expect(copyIdentityAccessCredentialDigestBytes(candidates.access.digest)).toEqual(
      copyIdentityAccessCredentialDigestBytes(expectedAccessDigest),
    );
    expect(copyIdentityRefreshCredentialDigestBytes(candidates.refresh.digest)).toEqual(
      copyIdentityRefreshCredentialDigestBytes(expectedRefreshDigest),
    );
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates.access)).toBe(true);
    expect(Object.isFrozen(candidates.refresh)).toBe(true);
    expect(JSON.stringify(candidates)).not.toContain(accessWire);
    expect(JSON.stringify(candidates)).not.toContain(refreshWire);
  });
});

export type _LeakedCryptoPrimitives = LeakedRootCryptoPrimitives;
export type _LeakedCryptoFactory = typeof LeakedRootCryptoFactory;
export type _LeakedSubpathCryptoPrimitives = LeakedSubpathCryptoPrimitives;
export type _LeakedSubpathCryptoFactory = typeof LeakedSubpathCryptoFactory;
