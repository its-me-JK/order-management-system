import { InvalidIdentityAccessCredentialStateError } from '../src/domain/identity-access-credential.errors';
import {
  IdentityAccessCredential,
  type IdentityAccessCredentialSnapshot,
} from '../src/domain/identity-access-credential';
import {
  InvalidIdentityAccessCredentialIdError,
  InvalidIdentityAccessLifetimeSecondsError,
  MAX_IDENTITY_ACCESS_LIFETIME_SECONDS,
  MIN_IDENTITY_ACCESS_LIFETIME_SECONDS,
  parseIdentityAccessCredentialId,
  parseIdentityAccessLifetimeSeconds,
  type IdentityAccessCredentialId,
  type IdentityAccessLifetimeSeconds,
} from '../src/domain/identity-access-credential.values';
import {
  MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE,
  parseIdentityRefreshCredentialSequence,
} from '../src/domain/identity-refresh-credential.values';
import { parseIdentitySessionId } from '../src/domain/identity-session-family.values';
import { parseIdentityInstant } from '../src/domain/identity-values';

const CREDENTIAL_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const ISSUED_AT = '2026-08-23T10:00:00.000001Z';
const MINIMUM_EXPIRES_AT = '2026-08-23T10:00:01.000001Z';

type RawAccessCredentialSnapshot = Readonly<{
  id: unknown;
  sessionId: unknown;
  sequence: unknown;
  issuedAt: unknown;
  expiresAt: unknown;
}>;

type ErrorClass = abstract new (...arguments_: never[]) => Error;

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
  rejectedValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

function accessCredentialSnapshot(
  overrides: Partial<RawAccessCredentialSnapshot> = {},
): RawAccessCredentialSnapshot {
  return {
    id: CREDENTIAL_ID,
    sessionId: SESSION_ID,
    sequence: 1,
    issuedAt: ISSUED_AT,
    expiresAt: MINIMUM_EXPIRES_AT,
    ...overrides,
  };
}

describe('Identity Access Credential values', (): void => {
  it.each([
    '00000000-0000-7000-8000-000000000000',
    CREDENTIAL_ID,
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ])('retains canonical lowercase UUIDv7 credential id %s', (credentialId): void => {
    expect(parseIdentityAccessCredentialId(credentialId)).toBe(credentialId);
  });

  it.each([
    ['uppercase', '01890F3A-8BCD-7DEF-8ABC-0123456789AB'],
    ['UUIDv4', '01890f3a-8bcd-4def-8abc-0123456789ab'],
    ['non-RFC variant', '01890f3a-8bcd-7def-7abc-0123456789ab'],
    ['missing separators', '01890f3a8bcd7def8abc0123456789ab'],
    ['leading whitespace', ` ${CREDENTIAL_ID}`],
    ['trailing whitespace', `${CREDENTIAL_ID} `],
    ['sensitive malformed value', 'access-credential-secret'],
    ['number', 7],
    ['null', null],
  ])('rejects credential id with %s without normalization', (_scenario, credentialId): void => {
    expect(() => parseIdentityAccessCredentialId(credentialId)).toThrow(
      InvalidIdentityAccessCredentialIdError,
    );
  });

  it.each([
    MIN_IDENTITY_ACCESS_LIFETIME_SECONDS,
    MIN_IDENTITY_ACCESS_LIFETIME_SECONDS + 1,
    MAX_IDENTITY_ACCESS_LIFETIME_SECONDS,
  ])('retains configured access lifetime %d', (lifetime): void => {
    expect(parseIdentityAccessLifetimeSeconds(lifetime)).toBe(lifetime);
  });

  it.each([
    MIN_IDENTITY_ACCESS_LIFETIME_SECONDS - 1,
    MAX_IDENTITY_ACCESS_LIFETIME_SECONDS + 1,
    300.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    '300',
    null,
    undefined,
  ])('rejects unsupported configured access lifetime %p', (lifetime): void => {
    expect(() => parseIdentityAccessLifetimeSeconds(lifetime)).toThrow(
      InvalidIdentityAccessLifetimeSecondsError,
    );
  });

  it('publishes the configured lifetime envelope and fixed cause-free errors', (): void => {
    expect(MIN_IDENTITY_ACCESS_LIFETIME_SECONDS).toBe(300);
    expect(MAX_IDENTITY_ACCESS_LIFETIME_SECONDS).toBe(1_800);
    expectFixedSafeError(
      () => parseIdentityAccessCredentialId('access-credential-secret'),
      InvalidIdentityAccessCredentialIdError,
      ['access-credential-secret'],
    );
    expectFixedSafeError(
      () => parseIdentityAccessLifetimeSeconds('access-lifetime-secret'),
      InvalidIdentityAccessLifetimeSecondsError,
      ['access-lifetime-secret'],
    );
  });
});

describe('IdentityAccessCredential strict rehydration', (): void => {
  it.each([
    ['one-second actual interval', accessCredentialSnapshot()],
    [
      'fractionally different capped interval',
      accessCredentialSnapshot({ expiresAt: '2026-08-23T10:00:01.000002Z' }),
    ],
    [
      'configured minimum interval',
      accessCredentialSnapshot({ expiresAt: '2026-08-23T10:05:00.000001Z' }),
    ],
    [
      'maximum actual interval',
      accessCredentialSnapshot({ expiresAt: '2026-08-23T10:30:00.000001Z' }),
    ],
    [
      'retained expired row',
      accessCredentialSnapshot({
        issuedAt: '2024-02-29T23:59:58.123456Z',
        expiresAt: '2024-02-29T23:59:59.123456Z',
      }),
    ],
    [
      'maximum refresh generation',
      accessCredentialSnapshot({ sequence: MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE }),
    ],
    [
      'representable near-maximum instant under an overflowing upper bound',
      accessCredentialSnapshot({
        issuedAt: '9999-12-31T23:59:58.000001Z',
        expiresAt: '9999-12-31T23:59:59.999999Z',
      }),
    ],
  ] as const)('rehydrates a reachable intrinsic %s', (_scenario, raw): void => {
    const credential = IdentityAccessCredential.rehydrate(raw);

    expect(credential.toSnapshot()).toEqual(raw);
    expect(Object.isFrozen(credential)).toBe(true);
    expect(Object.isFrozen(credential.toSnapshot())).toBe(true);
    expect(Object.keys(credential)).toEqual([]);
    expect(JSON.stringify(credential)).toBe('{}');
  });

  it('copies caller-owned state and exposes only a frozen snapshot', (): void => {
    const raw = { ...accessCredentialSnapshot() };
    const credential = IdentityAccessCredential.rehydrate(raw);
    raw.sequence = 99;
    raw.expiresAt = 'persistence-mutated-time';

    expect(credential.toSnapshot()).toEqual(accessCredentialSnapshot());
    expect(() => {
      (credential.toSnapshot() as { sequence: number }).sequence = 99;
    }).toThrow(TypeError);
    expect(credential.toSnapshot()).toEqual(accessCredentialSnapshot());
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing members', { id: CREDENTIAL_ID }],
    [
      'additional member',
      { ...accessCredentialSnapshot(), internalSecret: 'persistence-access-secret' },
    ],
    ['invalid credential id', accessCredentialSnapshot({ id: 'persistence-access-secret' })],
    ['invalid session id', accessCredentialSnapshot({ sessionId: 'persistence-session-secret' })],
    ['invalid sequence', accessCredentialSnapshot({ sequence: 0 })],
    ['invalid issuance instant', accessCredentialSnapshot({ issuedAt: 'persistence-time-secret' })],
    ['invalid expiry instant', accessCredentialSnapshot({ expiresAt: 'not-an-instant' })],
    ['expiry equal to issuance', accessCredentialSnapshot({ expiresAt: ISSUED_AT })],
    [
      'expiry before issuance',
      accessCredentialSnapshot({ expiresAt: '2026-08-23T09:59:59.999999Z' }),
    ],
    [
      'expiry less than one whole second later',
      accessCredentialSnapshot({ expiresAt: '2026-08-23T10:00:01.000000Z' }),
    ],
    [
      'expiry more than thirty minutes later',
      accessCredentialSnapshot({ expiresAt: '2026-08-23T10:30:00.000002Z' }),
    ],
    [
      'near-maximum issuance without one representable second',
      accessCredentialSnapshot({
        issuedAt: '9999-12-31T23:59:59.000000Z',
        expiresAt: '9999-12-31T23:59:59.999999Z',
      }),
    ],
  ] as const)(
    'rejects an unreachable intrinsic %s with one fixed safe error',
    (_scenario, raw): void => {
      const error = captureError(() => IdentityAccessCredential.rehydrate(raw));

      expect(error).toBeInstanceOf(InvalidIdentityAccessCredentialStateError);
      expect(error).toMatchObject({
        name: 'InvalidIdentityAccessCredentialStateError',
        message: 'Expected a valid Identity Access Credential snapshot',
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      for (const forbidden of [
        'persistence-access-secret',
        'persistence-session-secret',
        'persistence-time-secret',
      ]) {
        expect(String(error)).not.toContain(forbidden);
        expect(JSON.stringify(error)).not.toContain(forbidden);
      }
    },
  );

  it('collapses hostile and revoked Proxy traps to the fixed safe state error', (): void => {
    const hostileSecret = 'hostile-access-proxy-secret';
    let hostileTrapCalls = 0;
    const hostileSnapshot = new Proxy(accessCredentialSnapshot(), {
      get(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
    });
    const hostileKeys = new Proxy(accessCredentialSnapshot(), {
      ownKeys(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
    });
    const revokedSnapshot = Proxy.revocable(accessCredentialSnapshot(), {});
    revokedSnapshot.revoke();

    for (const candidate of [hostileSnapshot, hostileKeys, revokedSnapshot.proxy]) {
      expectFixedSafeError(
        () => IdentityAccessCredential.rehydrate(candidate),
        InvalidIdentityAccessCredentialStateError,
        [hostileSecret],
      );
    }

    expect(hostileTrapCalls).toBeGreaterThan(0);
  });

  it('collapses a forged entity-shaped object instead of trusting its prototype', (): void => {
    const forged = Object.create(IdentityAccessCredential.prototype) as unknown;

    expectFixedSafeError(
      () => IdentityAccessCredential.rehydrate(forged),
      InvalidIdentityAccessCredentialStateError,
    );
  });
});

describe('IdentityAccessCredential internal issuance boundary', (): void => {
  it('issues the exact frozen snapshot from already parsed family state', (): void => {
    const input = {
      id: parseIdentityAccessCredentialId(CREDENTIAL_ID),
      sessionId: parseIdentitySessionId(SESSION_ID),
      sequence: parseIdentityRefreshCredentialSequence(2),
      issuedAt: parseIdentityInstant(ISSUED_AT),
      expiresAt: parseIdentityInstant('2026-08-23T10:15:00.000001Z'),
    };

    const credential = IdentityAccessCredential.issueForSessionFamily(input);

    expect(credential.toSnapshot()).toEqual(input);
    expect(credential.toSnapshot()).not.toBe(input);
    expect(Object.isFrozen(credential)).toBe(true);
    expect(Object.isFrozen(credential.toSnapshot())).toBe(true);
  });

  it('allows separately branded IDs to contain the same UUID bytes', (): void => {
    const credential = IdentityAccessCredential.issueForSessionFamily({
      id: parseIdentityAccessCredentialId(SESSION_ID),
      sessionId: parseIdentitySessionId(SESSION_ID),
      sequence: parseIdentityRefreshCredentialSequence(1),
      issuedAt: parseIdentityInstant(ISSUED_AT),
      expiresAt: parseIdentityInstant(MINIMUM_EXPIRES_AT),
    });

    expect(credential.toSnapshot()).toMatchObject({ id: SESSION_ID, sessionId: SESSION_ID });
  });
});

const _credentialId: IdentityAccessCredentialId = parseIdentityAccessCredentialId(CREDENTIAL_ID);
const _lifetime: IdentityAccessLifetimeSeconds = parseIdentityAccessLifetimeSeconds(
  MIN_IDENTITY_ACCESS_LIFETIME_SECONDS,
);
const _snapshot: IdentityAccessCredentialSnapshot = IdentityAccessCredential.rehydrate(
  accessCredentialSnapshot(),
).toSnapshot();
void _credentialId;
void _lifetime;
void _snapshot;
