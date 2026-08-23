import { inspect } from 'node:util';

import {
  claimIdentitySessionCredentialAttempt,
  commitIdentitySessionCredentialAttempt,
  consumeCommittedIdentitySessionCredentialAttempt,
  createIdentitySessionCredentialAttempt,
  inspectIdentitySessionCredentialAttemptDigestView,
  retireIdentitySessionCredentialAttempt,
  type IdentitySessionCredentialAttempt,
  type IdentitySessionCredentialAttemptDigestView,
} from '../src/application/identity-session-credential-attempt';
import {
  createIdentitySessionCredentialCandidates,
  type IdentitySessionCredentialCandidates,
} from '../src/application/identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from '../src/application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../src/application/identity-session-credential-digest.values';
import type * as DigestValuesModule from '../src/application/identity-session-credential-digest.values';
import {
  IdentitySessionCredentialCryptoUnavailableError,
  InvalidIdentitySessionCredentialCandidatesError,
} from '../src/application/identity-session-credential.errors';
import {
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
  serializeIdentityAccessCredentialWireValue,
  serializeIdentityRefreshCredentialWireValue,
  type IdentityAccessCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from '../src/application/identity-session-credential-wire.values';
import type {
  // @ts-expect-error Credential attempts remain package-internal.
  IdentitySessionCredentialAttempt as LeakedIdentitySessionCredentialAttempt,
} from '../src';
import * as identityPublicApi from '../src';

const ACCESS_WIRE = `oms_at_v1_${'A'.repeat(42)}E`;
const REFRESH_WIRE = `oms_rt_v1_${'E'.repeat(42)}M`;
const CANDIDATE_ERROR_MESSAGE = 'Expected valid Identity session credential candidates';
const CRYPTO_ERROR_MESSAGE = 'Identity session credential cryptography is temporarily unavailable';

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function bytes(fill: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(32);
  value.fill(fill);
  return value;
}

function accessDigest(fill = 1): IdentityAccessCredentialDigest {
  return createIdentityAccessCredentialDigestFromBytes(bytes(fill));
}

function refreshDigest(fill = 2): IdentityRefreshCredentialDigest {
  return createIdentityRefreshCredentialDigestFromBytes(bytes(fill));
}

function accessWire(value = ACCESS_WIRE): IdentityAccessCredentialWireValue {
  return parseIdentityAccessCredentialWireValue(value);
}

function refreshWire(value = REFRESH_WIRE): IdentityRefreshCredentialWireValue {
  return parseIdentityRefreshCredentialWireValue(value);
}

function candidates(
  accessDigestValue = accessDigest(),
  refreshDigestValue = refreshDigest(),
): IdentitySessionCredentialCandidates {
  return createIdentitySessionCredentialCandidates({
    access: { wireValue: accessWire(), digest: accessDigestValue },
    refresh: { wireValue: refreshWire(), digest: refreshDigestValue },
  });
}

function matchingCrypto(
  value: IdentitySessionCredentialCandidates,
  trace: string[] = [],
): IdentitySessionCredentialCrypto {
  return Object.freeze({
    generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
      return Promise.resolve(value);
    },
    digestAccessCredential(
      wireValue: IdentityAccessCredentialWireValue,
    ): Promise<IdentityAccessCredentialDigest> {
      trace.push(`access:${serializeIdentityAccessCredentialWireValue(wireValue)}`);
      return Promise.resolve(accessDigest());
    },
    digestRefreshCredential(
      wireValue: IdentityRefreshCredentialWireValue,
    ): Promise<IdentityRefreshCredentialDigest> {
      trace.push(`refresh:${serializeIdentityRefreshCredentialWireValue(wireValue)}`);
      return Promise.resolve(refreshDigest());
    },
  });
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

function captureSynchronousError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

function expectFixedError(
  error: Error,
  ExpectedError: ErrorClass,
  expectedMessage: string,
  secrets: readonly string[] = [],
): void {
  expect(error).toBeInstanceOf(ExpectedError);
  expect(error.message).toBe(expectedMessage);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const secret of secrets) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error.stack ?? '').not.toContain(secret);
  }
}

async function expectCandidateRejection(operation: () => Promise<unknown>): Promise<void> {
  expectFixedError(
    await captureAsyncError(operation),
    InvalidIdentitySessionCredentialCandidatesError,
    CANDIDATE_ERROR_MESSAGE,
    [ACCESS_WIRE, REFRESH_WIRE],
  );
}

function expectCandidateThrow(operation: () => unknown): void {
  expectFixedError(
    captureSynchronousError(operation),
    InvalidIdentitySessionCredentialCandidatesError,
    CANDIDATE_ERROR_MESSAGE,
    [ACCESS_WIRE, REFRESH_WIRE],
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

const DIGEST_VALUES_MODULE_PATH = '../src/application/identity-session-credential-digest.values';

type TrackedAttemptBoundary = Readonly<{
  attemptModule: Readonly<{
    createIdentitySessionCredentialAttempt: typeof createIdentitySessionCredentialAttempt;
  }>;
  digestModule: Readonly<{
    createIdentityAccessCredentialDigestFromBytes: typeof createIdentityAccessCredentialDigestFromBytes;
    createIdentityRefreshCredentialDigestFromBytes: typeof createIdentityRefreshCredentialDigestFromBytes;
  }>;
  errorModule: Readonly<{
    IdentitySessionCredentialCryptoUnavailableError: typeof IdentitySessionCredentialCryptoUnavailableError;
    InvalidIdentitySessionCredentialCandidatesError: typeof InvalidIdentitySessionCredentialCandidatesError;
  }>;
  pair: IdentitySessionCredentialCandidates;
  copies: Uint8Array<ArrayBuffer>[];
  detachNextCopy(): void;
}>;

type CandidateModule = Readonly<{
  createIdentitySessionCredentialCandidates: typeof createIdentitySessionCredentialCandidates;
}>;

type WireModule = Readonly<{
  parseIdentityAccessCredentialWireValue: typeof parseIdentityAccessCredentialWireValue;
  parseIdentityRefreshCredentialWireValue: typeof parseIdentityRefreshCredentialWireValue;
}>;

function loadTrackedAttemptBoundary(): TrackedAttemptBoundary {
  jest.dontMock(DIGEST_VALUES_MODULE_PATH);
  jest.resetModules();

  const copies: Uint8Array<ArrayBuffer>[] = [];
  let detachNextCopy = false;

  jest.doMock(DIGEST_VALUES_MODULE_PATH, (): unknown => {
    const actual = jest.requireActual<typeof DigestValuesModule>(DIGEST_VALUES_MODULE_PATH);

    function recordCopy(copy: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
      copies.push(copy);

      if (detachNextCopy) {
        detachNextCopy = false;
        queueMicrotask((): void => {
          structuredClone(copy.buffer, { transfer: [copy.buffer] });
        });
      }

      return copy;
    }

    return {
      ...actual,
      copyIdentityAccessCredentialDigestBytes(
        value: IdentityAccessCredentialDigest,
      ): Uint8Array<ArrayBuffer> {
        return recordCopy(actual.copyIdentityAccessCredentialDigestBytes(value));
      },
      copyIdentityRefreshCredentialDigestBytes(
        value: IdentityRefreshCredentialDigest,
      ): Uint8Array<ArrayBuffer> {
        return recordCopy(actual.copyIdentityRefreshCredentialDigestBytes(value));
      },
    };
  });

  const digestModule =
    jest.requireMock<TrackedAttemptBoundary['digestModule']>(DIGEST_VALUES_MODULE_PATH);
  const candidateModule = jest.requireActual<CandidateModule>(
    '../src/application/identity-session-credential-candidates',
  );
  const wireModule = jest.requireActual<WireModule>(
    '../src/application/identity-session-credential-wire.values',
  );
  const attemptModule = jest.requireActual<TrackedAttemptBoundary['attemptModule']>(
    '../src/application/identity-session-credential-attempt',
  );
  const errorModule = jest.requireActual<TrackedAttemptBoundary['errorModule']>(
    '../src/application/identity-session-credential.errors',
  );
  const pair = candidateModule.createIdentitySessionCredentialCandidates({
    access: {
      wireValue: wireModule.parseIdentityAccessCredentialWireValue(ACCESS_WIRE),
      digest: digestModule.createIdentityAccessCredentialDigestFromBytes(bytes(1)),
    },
    refresh: {
      wireValue: wireModule.parseIdentityRefreshCredentialWireValue(REFRESH_WIRE),
      digest: digestModule.createIdentityRefreshCredentialDigestFromBytes(bytes(2)),
    },
  });
  copies.length = 0;

  return {
    attemptModule,
    digestModule,
    errorModule,
    pair,
    copies,
    detachNextCopy(): void {
      detachNextCopy = true;
    },
  };
}

function trackedCrypto(
  boundary: TrackedAttemptBoundary,
  accessFill = 1,
  refreshFill = 2,
): IdentitySessionCredentialCrypto {
  return Object.freeze({
    generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
      return Promise.resolve(boundary.pair);
    },
    digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
      return Promise.resolve(
        boundary.digestModule.createIdentityAccessCredentialDigestFromBytes(bytes(accessFill)),
      );
    },
    digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
      return Promise.resolve(
        boundary.digestModule.createIdentityRefreshCredentialDigestFromBytes(bytes(refreshFill)),
      );
    },
  });
}

function expectOverwrittenCopies(
  copies: readonly Uint8Array<ArrayBuffer>[],
  expectedCount: number,
): void {
  expect(copies).toHaveLength(expectedCount);

  for (const copy of copies) {
    expect(copy).toHaveLength(32);
    expect(Array.from(copy)).toEqual(new Array<number>(32).fill(0));
  }
}

describe('Identity session credential attempt verification', (): void => {
  it('re-digests access then refresh before returning one opaque exact-pair attempt', async (): Promise<void> => {
    const pair = candidates();
    const trace: string[] = [];
    const attempt = await createIdentitySessionCredentialAttempt(pair, matchingCrypto(pair, trace));

    expect(trace).toEqual([`access:${ACCESS_WIRE}`, `refresh:${REFRESH_WIRE}`]);
    expect(Reflect.ownKeys(attempt)).toEqual([]);
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(String(attempt)).toBe('[IdentitySessionCredentialAttempt]');
    expect(JSON.stringify(attempt)).toBe('{}');
    expect(inspect(attempt, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(attempt, { showHidden: true })).not.toContain(REFRESH_WIRE);

    const owner = Object.freeze({});
    claimIdentitySessionCredentialAttempt(attempt, owner);
    commitIdentitySessionCredentialAttempt(attempt, owner);
    expect(consumeCommittedIdentitySessionCredentialAttempt(attempt, pair)).toBe(pair);
  });

  it('rejects a wire-to-digest mismatch only after checking both target kinds', async (): Promise<void> => {
    const pair = candidates();

    for (const mismatchedKind of ['access', 'refresh'] as const) {
      const trace: string[] = [];
      const crypto: IdentitySessionCredentialCrypto = Object.freeze({
        generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
          return Promise.resolve(pair);
        },
        digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
          trace.push('access');
          return Promise.resolve(accessDigest(mismatchedKind === 'access' ? 9 : 1));
        },
        digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
          trace.push('refresh');
          return Promise.resolve(refreshDigest(mismatchedKind === 'refresh' ? 9 : 2));
        },
      });

      await expectCandidateRejection(() => createIdentitySessionCredentialAttempt(pair, crypto));
      expect(trace).toEqual(['access', 'refresh']);
    }
  });

  it.each([
    ['mutable outer pair', (pair: IdentitySessionCredentialCandidates): unknown => ({ ...pair })],
    [
      'additional outer member',
      (pair: IdentitySessionCredentialCandidates): unknown =>
        Object.freeze({ access: pair.access, refresh: pair.refresh, secret: ACCESS_WIRE }),
    ],
    [
      'reversed outer key order',
      (pair: IdentitySessionCredentialCandidates): unknown =>
        Object.freeze({ refresh: pair.refresh, access: pair.access }),
    ],
    [
      'mutable access record',
      (pair: IdentitySessionCredentialCandidates): unknown =>
        Object.freeze({ access: { ...pair.access }, refresh: pair.refresh }),
    ],
  ] as const)(
    'rejects %s before calling cryptography',
    async (_scenario, malformed): Promise<void> => {
      const pair = candidates();
      const trace: string[] = [];

      await expectCandidateRejection(() =>
        createIdentitySessionCredentialAttempt(malformed(pair), matchingCrypto(pair, trace)),
      );
      expect(trace).toEqual([]);
    },
  );

  it('collapses hostile candidate reflection to the fixed candidate error', async (): Promise<void> => {
    const pair = candidates();
    const secret = 'hostile-attempt-secret';
    const hostile = new Proxy(pair, {
      getPrototypeOf(): never {
        throw new Error(secret);
      },
    });

    const error = await captureAsyncError(() =>
      createIdentitySessionCredentialAttempt(hostile, matchingCrypto(pair)),
    );
    expectFixedError(
      error,
      InvalidIdentitySessionCredentialCandidatesError,
      CANDIDATE_ERROR_MESSAGE,
      [secret, ACCESS_WIRE, REFRESH_WIRE],
    );
  });

  it('collapses provider exceptions and invalid target-kind output to unavailable', async (): Promise<void> => {
    const pair = candidates();
    const secret = 'provider-attempt-secret';
    const scenarios: IdentitySessionCredentialCrypto[] = [
      Object.freeze({
        ...matchingCrypto(pair),
        digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
          return Promise.reject(new Error(secret));
        },
      }),
      Object.freeze({
        ...matchingCrypto(pair),
        digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
          return Promise.resolve(refreshDigest() as unknown as IdentityAccessCredentialDigest);
        },
      }),
    ];

    for (const crypto of scenarios) {
      const error = await captureAsyncError(() =>
        createIdentitySessionCredentialAttempt(pair, crypto),
      );
      expectFixedError(
        error,
        IdentitySessionCredentialCryptoUnavailableError,
        CRYPTO_ERROR_MESSAGE,
        [secret, ACCESS_WIRE, REFRESH_WIRE],
      );
    }
  });

  it('captures both digest function references before the first asynchronous provider result', async (): Promise<void> => {
    const pair = candidates();
    const deferred = createDeferred<IdentityAccessCredentialDigest>();
    const trace: string[] = [];
    const mutableCrypto: IdentitySessionCredentialCrypto = {
      generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
        return Promise.resolve(pair);
      },
      digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
        trace.push('original-access');
        return deferred.promise;
      },
      digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
        trace.push('original-refresh');
        return Promise.resolve(refreshDigest());
      },
    };
    const pendingAttempt = createIdentitySessionCredentialAttempt(pair, mutableCrypto);

    mutableCrypto.digestRefreshCredential = (): Promise<IdentityRefreshCredentialDigest> => {
      trace.push('mutated-refresh');
      return Promise.resolve(refreshDigest(9));
    };
    deferred.resolve(accessDigest());

    await expect(pendingAttempt).resolves.toBeDefined();
    expect(trace).toEqual(['original-access', 'original-refresh']);
  });
});

describe('Identity session credential attempt lifecycle', (): void => {
  it('remains absent from the package root', (): void => {
    expect(identityPublicApi).not.toHaveProperty('createIdentitySessionCredentialAttempt');
  });

  it('claims synchronously once and exposes only the original authentic digest wrappers', async (): Promise<void> => {
    const pair = candidates();
    const attempt = await createIdentitySessionCredentialAttempt(pair, matchingCrypto(pair));
    const owner = Object.freeze({ owner: 'winner' });
    const foreignOwner = Object.freeze({ owner: 'foreign' });
    const view = claimIdentitySessionCredentialAttempt(attempt, owner);

    expect(Object.keys(view)).toEqual(['accessCredentialDigest', 'refreshCredentialDigest']);
    expect(Reflect.ownKeys(view)).toEqual(['accessCredentialDigest', 'refreshCredentialDigest']);
    expect(Object.isFrozen(view)).toBe(true);
    expect(view.accessCredentialDigest).toBe(pair.access.digest);
    expect(view.refreshCredentialDigest).toBe(pair.refresh.digest);
    expect(inspectIdentitySessionCredentialAttemptDigestView(view, owner)).toBe(view);
    expectCandidateThrow(() =>
      inspectIdentitySessionCredentialAttemptDigestView(
        Object.freeze({
          accessCredentialDigest: pair.access.digest,
          refreshCredentialDigest: pair.refresh.digest,
        }),
        owner,
      ),
    );
    expectCandidateThrow(() =>
      inspectIdentitySessionCredentialAttemptDigestView(view, foreignOwner),
    );
    expect(inspectIdentitySessionCredentialAttemptDigestView(view, owner)).toBe(view);

    expectCandidateThrow(() => claimIdentitySessionCredentialAttempt(attempt, owner));
    expectCandidateThrow(() => claimIdentitySessionCredentialAttempt(attempt, foreignOwner));
    commitIdentitySessionCredentialAttempt(attempt, owner);
    expectCandidateThrow(() => inspectIdentitySessionCredentialAttemptDigestView(view, owner));
    expect(consumeCommittedIdentitySessionCredentialAttempt(attempt, pair)).toBe(pair);
    expectCandidateThrow(() => inspectIdentitySessionCredentialAttemptDigestView(view, owner));
  });

  it('lets only the winning owner commit or retire without foreign-call sabotage', async (): Promise<void> => {
    const pairToCommit = candidates();
    const committedAttempt = await createIdentitySessionCredentialAttempt(
      pairToCommit,
      matchingCrypto(pairToCommit),
    );
    const owner = Object.freeze({});
    const foreignOwner = Object.freeze({});
    claimIdentitySessionCredentialAttempt(committedAttempt, owner);

    expectCandidateThrow((): void => {
      commitIdentitySessionCredentialAttempt(committedAttempt, foreignOwner);
    });
    expectCandidateThrow((): void => {
      retireIdentitySessionCredentialAttempt(committedAttempt, foreignOwner);
    });
    commitIdentitySessionCredentialAttempt(committedAttempt, owner);
    expect(consumeCommittedIdentitySessionCredentialAttempt(committedAttempt, pairToCommit)).toBe(
      pairToCommit,
    );

    const pairToRetire = candidates();
    const retiredAttempt = await createIdentitySessionCredentialAttempt(
      pairToRetire,
      matchingCrypto(pairToRetire),
    );
    const retiredView = claimIdentitySessionCredentialAttempt(retiredAttempt, owner);
    expectCandidateThrow((): void => {
      retireIdentitySessionCredentialAttempt(retiredAttempt, foreignOwner);
    });
    retireIdentitySessionCredentialAttempt(retiredAttempt, owner);
    expectCandidateThrow(() =>
      inspectIdentitySessionCredentialAttemptDigestView(retiredView, owner),
    );
    expectCandidateThrow((): void => {
      commitIdentitySessionCredentialAttempt(retiredAttempt, owner);
    });
    expectCandidateThrow(() =>
      consumeCommittedIdentitySessionCredentialAttempt(retiredAttempt, pairToRetire),
    );
  });

  it('requires the exact registered pair and consumes committed delivery once', async (): Promise<void> => {
    const pair = candidates();
    const attempt = await createIdentitySessionCredentialAttempt(pair, matchingCrypto(pair));
    const owner = Object.freeze({});
    claimIdentitySessionCredentialAttempt(attempt, owner);
    commitIdentitySessionCredentialAttempt(attempt, owner);
    const sameMembersInAnotherPair = Object.freeze({
      access: pair.access,
      refresh: pair.refresh,
    });

    expectCandidateThrow(() =>
      consumeCommittedIdentitySessionCredentialAttempt(attempt, sameMembersInAnotherPair),
    );
    expect(consumeCommittedIdentitySessionCredentialAttempt(attempt, pair)).toBe(pair);
    expectCandidateThrow(() => consumeCommittedIdentitySessionCredentialAttempt(attempt, pair));
  });

  it('rejects forged, cloned, and recovered-constructor attempts', async (): Promise<void> => {
    const pair = candidates();
    const attempt = await createIdentitySessionCredentialAttempt(pair, matchingCrypto(pair));
    const owner = Object.freeze({});
    const prototype = Object.getPrototypeOf(attempt) as Readonly<{ constructor: unknown }>;
    const AttemptConstructor = prototype.constructor as new (
      capability: unknown,
      state: unknown,
    ) => unknown;

    expectCandidateThrow(() => claimIdentitySessionCredentialAttempt(Object.freeze({}), owner));
    expectCandidateThrow(() =>
      claimIdentitySessionCredentialAttempt(Object.create(prototype), owner),
    );
    expectCandidateThrow(() => new AttemptConstructor(Object.freeze({}), Object.freeze({})));
  });
});

describe('Identity session credential attempt temporary digest cleanup', (): void => {
  afterEach((): void => {
    jest.dontMock(DIGEST_VALUES_MODULE_PATH);
    jest.resetModules();
  });

  it('overwrites every candidate and verifier copy after a match', async (): Promise<void> => {
    const boundary = loadTrackedAttemptBoundary();

    await expect(
      boundary.attemptModule.createIdentitySessionCredentialAttempt(
        boundary.pair,
        trackedCrypto(boundary),
      ),
    ).resolves.toBeDefined();
    expectOverwrittenCopies(boundary.copies, 4);
  });

  it('overwrites all four copies after checking both digests on a mismatch', async (): Promise<void> => {
    const boundary = loadTrackedAttemptBoundary();
    const error = await captureAsyncError(() =>
      boundary.attemptModule.createIdentitySessionCredentialAttempt(
        boundary.pair,
        trackedCrypto(boundary, 9),
      ),
    );

    expectFixedError(
      error,
      boundary.errorModule.InvalidIdentitySessionCredentialCandidatesError,
      CANDIDATE_ERROR_MESSAGE,
    );
    expectOverwrittenCopies(boundary.copies, 4);
  });

  it('overwrites candidate and completed-verifier copies after a partial provider failure', async (): Promise<void> => {
    const boundary = loadTrackedAttemptBoundary();
    const crypto: IdentitySessionCredentialCrypto = Object.freeze({
      ...trackedCrypto(boundary),
      digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
        return Promise.reject(new Error('partial-provider-secret'));
      },
    });
    const error = await captureAsyncError(() =>
      boundary.attemptModule.createIdentitySessionCredentialAttempt(boundary.pair, crypto),
    );

    expectFixedError(
      error,
      boundary.errorModule.IdentitySessionCredentialCryptoUnavailableError,
      CRYPTO_ERROR_MESSAGE,
      ['partial-provider-secret'],
    );
    expectOverwrittenCopies(boundary.copies, 3);
  });

  it('overwrites candidate copies after thrown and invalid provider results', async (): Promise<void> => {
    for (const resultKind of ['thrown', 'invalid'] as const) {
      const boundary = loadTrackedAttemptBoundary();
      const crypto: IdentitySessionCredentialCrypto = Object.freeze({
        ...trackedCrypto(boundary),
        digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
          if (resultKind === 'thrown') {
            return Promise.reject(new Error('access-provider-secret'));
          }

          return Promise.resolve(
            boundary.digestModule.createIdentityRefreshCredentialDigestFromBytes(
              bytes(1),
            ) as unknown as IdentityAccessCredentialDigest,
          );
        },
      });
      const error = await captureAsyncError(() =>
        boundary.attemptModule.createIdentitySessionCredentialAttempt(boundary.pair, crypto),
      );

      expectFixedError(
        error,
        boundary.errorModule.IdentitySessionCredentialCryptoUnavailableError,
        CRYPTO_ERROR_MESSAGE,
        ['access-provider-secret'],
      );
      expectOverwrittenCopies(boundary.copies, 2);
    }
  });

  it('gives cleanup failure unavailable precedence after invalidating the failed copy', async (): Promise<void> => {
    const boundary = loadTrackedAttemptBoundary();
    boundary.detachNextCopy();
    const error = await captureAsyncError(() =>
      boundary.attemptModule.createIdentitySessionCredentialAttempt(
        boundary.pair,
        trackedCrypto(boundary),
      ),
    );

    expectFixedError(
      error,
      boundary.errorModule.IdentitySessionCredentialCryptoUnavailableError,
      CRYPTO_ERROR_MESSAGE,
    );
    expect(boundary.copies).toHaveLength(4);
    expect(boundary.copies[0]).toHaveLength(0);
    expectOverwrittenCopies(boundary.copies.slice(1), 3);
  });
});

void (undefined as unknown as LeakedIdentitySessionCredentialAttempt);

// @ts-expect-error Structural values cannot acquire attempt authority.
const forgedAttempt: IdentitySessionCredentialAttempt = Object.freeze({});
// @ts-expect-error Structural digest views cannot acquire extraction authority.
const forgedDigestView: IdentitySessionCredentialAttemptDigestView = Object.freeze({
  accessCredentialDigest: accessDigest(),
  refreshCredentialDigest: refreshDigest(),
});
void forgedAttempt;
void forgedDigestView;
