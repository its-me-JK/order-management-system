import { inspect } from 'node:util';

import {
  createIdentitySessionCredentialCandidates,
  type IdentityAccessCredentialCandidate,
  type IdentityRefreshCredentialCandidate,
  type IdentitySessionCredentialCandidates,
} from '../src/application/identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from '../src/application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../src/application/identity-session-credential-digest.values';
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

const ACCESS_PAYLOAD = `${'A'.repeat(42)}E`;
const REFRESH_PAYLOAD = `${'A'.repeat(42)}I`;
const OTHER_REFRESH_PAYLOAD = `${'E'.repeat(42)}M`;
const ACCESS_WIRE = `oms_at_v1_${ACCESS_PAYLOAD}`;
const REFRESH_WIRE = `oms_rt_v1_${REFRESH_PAYLOAD}`;

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function digestBytes(fill: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32);
  bytes.fill(fill);
  return bytes;
}

function accessWire(value = ACCESS_WIRE): IdentityAccessCredentialWireValue {
  return parseIdentityAccessCredentialWireValue(value);
}

function refreshWire(value = REFRESH_WIRE): IdentityRefreshCredentialWireValue {
  return parseIdentityRefreshCredentialWireValue(value);
}

function accessDigest(fill = 1): IdentityAccessCredentialDigest {
  return createIdentityAccessCredentialDigestFromBytes(digestBytes(fill));
}

function refreshDigest(fill = 2): IdentityRefreshCredentialDigest {
  return createIdentityRefreshCredentialDigestFromBytes(digestBytes(fill));
}

function candidateInput(): Readonly<{
  access: Readonly<{ wireValue: unknown; digest: unknown }>;
  refresh: Readonly<{ wireValue: unknown; digest: unknown }>;
}> {
  return {
    access: { wireValue: accessWire(), digest: accessDigest() },
    refresh: { wireValue: refreshWire(), digest: refreshDigest() },
  };
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

function expectFixedSafeError(
  operation: () => unknown,
  expectedClass: ErrorClass,
  secretValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect(error).toMatchObject({
    name: 'InvalidIdentitySessionCredentialCandidatesError',
    message: 'Expected valid Identity session credential candidates',
  });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  for (const secret of secretValues) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  }
}

describe('Identity session credential candidates', (): void => {
  it('returns the exact recursively frozen runtime shape in stable key order', (): void => {
    const candidates = createIdentitySessionCredentialCandidates({
      refresh: { digest: refreshDigest(), wireValue: refreshWire() },
      access: { digest: accessDigest(), wireValue: accessWire() },
    });

    expect(Object.keys(candidates)).toEqual(['access', 'refresh']);
    expect(Reflect.ownKeys(candidates)).toEqual(['access', 'refresh']);
    expect(Object.keys(candidates.access)).toEqual(['wireValue', 'digest']);
    expect(Reflect.ownKeys(candidates.access)).toEqual(['wireValue', 'digest']);
    expect(Object.keys(candidates.refresh)).toEqual(['wireValue', 'digest']);
    expect(Reflect.ownKeys(candidates.refresh)).toEqual(['wireValue', 'digest']);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates.access)).toBe(true);
    expect(Object.isFrozen(candidates.refresh)).toBe(true);
    expect(Object.isFrozen(candidates.access.wireValue)).toBe(true);
    expect(Object.isFrozen(candidates.access.digest)).toBe(true);
    expect(Object.isFrozen(candidates.refresh.wireValue)).toBe(true);
    expect(Object.isFrozen(candidates.refresh.digest)).toBe(true);
  });

  it('copies nested records and is unaffected by later input mutation', (): void => {
    const access = { wireValue: accessWire(), digest: accessDigest() };
    const refresh = { wireValue: refreshWire(), digest: refreshDigest() };
    const input = { access, refresh };
    const candidates = createIdentitySessionCredentialCandidates(input);

    expect(candidates).not.toBe(input);
    expect(candidates.access).not.toBe(access);
    expect(candidates.refresh).not.toBe(refresh);

    access.wireValue = accessWire(`oms_at_v1_${'E'.repeat(42)}M`);
    access.digest = accessDigest(9);
    refresh.wireValue = refreshWire(`oms_rt_v1_${OTHER_REFRESH_PAYLOAD}`);
    refresh.digest = refreshDigest(10);

    expect(serializeIdentityAccessCredentialWireValue(candidates.access.wireValue)).toBe(
      ACCESS_WIRE,
    );
    expect(serializeIdentityRefreshCredentialWireValue(candidates.refresh.wireValue)).toBe(
      REFRESH_WIRE,
    );
    expect(() => {
      (candidates as unknown as { access: unknown }).access = null;
    }).toThrow(TypeError);
    expect(() => {
      (candidates.access as unknown as { digest: unknown }).digest = null;
    }).toThrow(TypeError);
  });

  it.each([
    ['non-record outer value', null],
    ['array outer value', []],
    ['missing access record', { refresh: candidateInput().refresh }],
    ['missing refresh record', { access: candidateInput().access }],
    ['additional outer member', { ...candidateInput(), secret: ACCESS_WIRE }],
    ['non-record access candidate', { ...candidateInput(), access: null }],
    ['non-record refresh candidate', { ...candidateInput(), refresh: null }],
    [
      'additional access member',
      { ...candidateInput(), access: { ...candidateInput().access, secret: ACCESS_WIRE } },
    ],
    [
      'additional refresh member',
      { ...candidateInput(), refresh: { ...candidateInput().refresh, secret: REFRESH_WIRE } },
    ],
  ] as const)('rejects %s with one safe pair error', (_scenario, input): void => {
    expectFixedSafeError(
      () => createIdentitySessionCredentialCandidates(input),
      InvalidIdentitySessionCredentialCandidatesError,
      [ACCESS_WIRE, REFRESH_WIRE],
    );
  });

  it.each([
    [
      'refresh wire in the access candidate',
      { ...candidateInput(), access: { ...candidateInput().access, wireValue: refreshWire() } },
    ],
    [
      'access digest in the refresh candidate',
      { ...candidateInput(), refresh: { ...candidateInput().refresh, digest: accessDigest() } },
    ],
    [
      'access wire Proxy',
      {
        ...candidateInput(),
        access: {
          ...candidateInput().access,
          wireValue: new Proxy(accessWire(), {}),
        },
      },
    ],
    [
      'refresh digest Proxy',
      {
        ...candidateInput(),
        refresh: {
          ...candidateInput().refresh,
          digest: new Proxy(refreshDigest(), {}),
        },
      },
    ],
    [
      'forged access wire',
      {
        ...candidateInput(),
        access: {
          ...candidateInput().access,
          wireValue: Object.create(Object.getPrototypeOf(accessWire()) as object) as unknown,
        },
      },
    ],
  ] as const)('rejects %s', (_scenario, input): void => {
    expectFixedSafeError(
      () => createIdentitySessionCredentialCandidates(input),
      InvalidIdentitySessionCredentialCandidatesError,
    );
  });

  it('rejects equal payloads across access and refresh wrappers', (): void => {
    const input = candidateInput();

    expectFixedSafeError(
      () =>
        createIdentitySessionCredentialCandidates({
          access: input.access,
          refresh: {
            ...input.refresh,
            wireValue: refreshWire(`oms_rt_v1_${ACCESS_PAYLOAD}`),
          },
        }),
      InvalidIdentitySessionCredentialCandidatesError,
      [ACCESS_WIRE],
    );
  });

  it('rejects equal digest bytes across separate digest namespaces', (): void => {
    const bytes = digestBytes(7);
    const input = candidateInput();

    expectFixedSafeError(
      () =>
        createIdentitySessionCredentialCandidates({
          access: {
            ...input.access,
            digest: createIdentityAccessCredentialDigestFromBytes(bytes),
          },
          refresh: {
            ...input.refresh,
            digest: createIdentityRefreshCredentialDigestFromBytes(bytes),
          },
        }),
      InvalidIdentitySessionCredentialCandidatesError,
    );
  });

  it('collapses hostile getters and Proxy reflection without exposing their values', (): void => {
    const secret = 'candidate-hostile-secret';
    const throwingGetter = candidateInput();
    Object.defineProperty(throwingGetter, 'access', {
      configurable: true,
      enumerable: true,
      get(): never {
        throw new Error(secret);
      },
    });
    const throwingKeysProxy = new Proxy(candidateInput(), {
      ownKeys(): never {
        throw new Error(secret);
      },
    });

    for (const input of [throwingGetter, throwingKeysProxy]) {
      expectFixedSafeError(
        () => createIdentitySessionCredentialCandidates(input),
        InvalidIdentitySessionCredentialCandidatesError,
        [secret],
      );
    }
  });

  it('keeps every wire value and digest redacted through candidate inspection', (): void => {
    const candidates = createIdentitySessionCredentialCandidates(candidateInput());
    const serialized = JSON.stringify(candidates);

    expect((candidates.access.wireValue as unknown as { toString(): string }).toString()).toBe(
      '[REDACTED]',
    );
    expect((candidates.refresh.wireValue as unknown as { toString(): string }).toString()).toBe(
      '[REDACTED]',
    );
    expect(String(candidates.access.digest)).toBe('[REDACTED]');
    expect(String(candidates.refresh.digest)).toBe('[REDACTED]');
    expect(serialized).not.toContain(ACCESS_WIRE);
    expect(serialized).not.toContain(REFRESH_WIRE);
    expect(inspect(candidates, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(candidates, { showHidden: true })).not.toContain(REFRESH_WIRE);
    expect(serialized).toBe(
      '{"access":{"wireValue":"[REDACTED]","digest":"[REDACTED]"},"refresh":{"wireValue":"[REDACTED]","digest":"[REDACTED]"}}',
    );
  });
});

describe('Identity session credential crypto failure contract', (): void => {
  it('exposes one fixed cause-free unavailable error', (): void => {
    const error = new IdentitySessionCredentialCryptoUnavailableError();

    expect(error).toMatchObject({
      name: 'IdentitySessionCredentialCryptoUnavailableError',
      message: 'Identity session credential cryptography is temporarily unavailable',
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

const compileOnlyCryptoPort: IdentitySessionCredentialCrypto = {
  generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
    return Promise.resolve(createIdentitySessionCredentialCandidates(candidateInput()));
  },
  digestAccessCredential(
    wireValue: IdentityAccessCredentialWireValue,
  ): Promise<IdentityAccessCredentialDigest> {
    serializeIdentityAccessCredentialWireValue(wireValue);
    return Promise.resolve(accessDigest());
  },
  digestRefreshCredential(
    wireValue: IdentityRefreshCredentialWireValue,
  ): Promise<IdentityRefreshCredentialDigest> {
    serializeIdentityRefreshCredentialWireValue(wireValue);
    return Promise.resolve(refreshDigest());
  },
};
void compileOnlyCryptoPort;

// @ts-expect-error Structural records cannot acquire the access-candidate authority brand.
const structurallyForgedAccessCandidate: IdentityAccessCredentialCandidate = {
  wireValue: accessWire(),
  digest: accessDigest(),
};
// @ts-expect-error Structural records cannot acquire the refresh-candidate authority brand.
const structurallyForgedRefreshCandidate: IdentityRefreshCredentialCandidate = {
  wireValue: refreshWire(),
  digest: refreshDigest(),
};
// @ts-expect-error A complete structural pair still lacks the whole-pair authority brand.
const structurallyForgedCandidates: IdentitySessionCredentialCandidates = {
  access: structurallyForgedAccessCandidate,
  refresh: structurallyForgedRefreshCandidate,
};
void structurallyForgedAccessCandidate;
void structurallyForgedRefreshCandidate;
void structurallyForgedCandidates;
