import { InvalidIdentityAccountIdError } from '../src/domain/identity-account.values';
import {
  IdentitySessionFamilyDeadlineOverflowError,
  IdentitySessionFamilyTimestampRegressionError,
  InvalidIdentitySessionFamilyStateError,
} from '../src/domain/identity-session-family.errors';
import {
  IdentitySessionFamily,
  type IdentitySessionFamilySnapshot,
} from '../src/domain/identity-session-family';
import {
  IDENTITY_SESSION_FAMILY_AUTHENTICATION_STATES,
  IDENTITY_SESSION_FAMILY_CLOSED_REASONS,
  IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS,
  InvalidIdentityRefreshAbsoluteLifetimeSecondsError,
  InvalidIdentityRefreshIdleLifetimeSecondsError,
  InvalidIdentitySessionFamilyClosedReasonError,
  InvalidIdentitySessionFamilyGenericRevocationReasonError,
  InvalidIdentitySessionIdError,
  MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
  MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
  MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
  MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
  parseIdentityRefreshAbsoluteLifetimeSeconds,
  parseIdentityRefreshIdleLifetimeSeconds,
  parseIdentitySessionFamilyClosedReason,
  parseIdentitySessionFamilyGenericRevocationReason,
  parseIdentitySessionId,
  type IdentityRefreshAbsoluteLifetimeSeconds,
  type IdentityRefreshIdleLifetimeSeconds,
  type IdentitySessionId,
} from '../src/domain/identity-session-family.values';
import {
  IdentityAggregateVersionExhaustedError,
  InvalidIdentityInstantError,
  MAX_IDENTITY_AGGREGATE_VERSION,
} from '../src/domain/identity-values';

const SESSION_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const CREATED_AT = '2026-08-23T10:00:00.000001Z';
const INITIAL_IDLE_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const ROTATED_AT = '2026-08-23T10:30:00.000002Z';
const ROTATED_IDLE_EXPIRES_AT = '2026-08-23T10:45:00.000002Z';
const BEFORE_CREATED_AT = '2026-08-23T09:59:59.999999Z';

type RawSessionFamilySnapshot = Readonly<{
  id: unknown;
  accountId: unknown;
  version: unknown;
  createdAt: unknown;
  lastRotatedAt: unknown;
  refreshIdleExpiresAt: unknown;
  refreshAbsoluteExpiresAt: unknown;
  revokedAt: unknown;
  closedReason: unknown;
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

function initialSnapshot(
  overrides: Partial<RawSessionFamilySnapshot> = {},
): RawSessionFamilySnapshot {
  return {
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    version: 1,
    createdAt: CREATED_AT,
    lastRotatedAt: CREATED_AT,
    refreshIdleExpiresAt: INITIAL_IDLE_EXPIRES_AT,
    refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    revokedAt: null,
    closedReason: null,
    ...overrides,
  };
}

function directlyRevokedSnapshot(
  overrides: Partial<RawSessionFamilySnapshot> = {},
): RawSessionFamilySnapshot {
  return initialSnapshot({
    version: 2,
    revokedAt: CREATED_AT,
    closedReason: 'LOGOUT',
    ...overrides,
  });
}

function rotatedSnapshot(
  overrides: Partial<RawSessionFamilySnapshot> = {},
): RawSessionFamilySnapshot {
  return initialSnapshot({
    version: 2,
    lastRotatedAt: ROTATED_AT,
    refreshIdleExpiresAt: ROTATED_IDLE_EXPIRES_AT,
    ...overrides,
  });
}

function cappedRotatedSnapshot(
  overrides: Partial<RawSessionFamilySnapshot> = {},
): RawSessionFamilySnapshot {
  return rotatedSnapshot({
    lastRotatedAt: '2026-08-24T09:59:59.000001Z',
    refreshIdleExpiresAt: ABSOLUTE_EXPIRES_AT,
    ...overrides,
  });
}

function reuseRevokedSnapshot(
  overrides: Partial<RawSessionFamilySnapshot> = {},
): RawSessionFamilySnapshot {
  return rotatedSnapshot({
    version: 3,
    revokedAt: '2026-08-23T10:31:00.000003Z',
    closedReason: 'REFRESH_REUSE_DETECTED',
    ...overrides,
  });
}

function expiredSnapshot(
  overrides: Partial<RawSessionFamilySnapshot> = {},
): RawSessionFamilySnapshot {
  return initialSnapshot({
    createdAt: '2024-02-28T23:59:59.123456Z',
    lastRotatedAt: '2024-02-28T23:59:59.123456Z',
    refreshIdleExpiresAt: '2024-02-29T00:14:59.123456Z',
    refreshAbsoluteExpiresAt: '2024-02-29T23:59:59.123456Z',
    ...overrides,
  });
}

function createSessionFamily(): IdentitySessionFamily {
  return IdentitySessionFamily.create({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
    occurredAt: CREATED_AT,
  }).sessionFamily;
}

function expectFrozenSafeFacts(facts: readonly object[]): void {
  expect(Object.isFrozen(facts)).toBe(true);

  for (const fact of facts) {
    expect(Object.isFrozen(fact)).toBe(true);
  }

  const serialized = JSON.stringify(facts);
  for (const forbidden of [
    'refreshIdleExpiresAt',
    'refreshAbsoluteExpiresAt',
    'credentialId',
    'sequence',
    'digest',
    'cookie',
    'userAgent',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}

function expectSafeImmutableRejection(
  sessionFamily: IdentitySessionFamily,
  operation: () => unknown,
  expectedClass: ErrorClass,
  rejectedValues: readonly string[] = [],
): void {
  const before = sessionFamily.toSnapshot();

  expectFixedSafeError(operation, expectedClass, rejectedValues);
  expect(sessionFamily.toSnapshot()).toBe(before);
  expect(sessionFamily.toSnapshot()).toEqual(before);
  expect(Object.isFrozen(sessionFamily)).toBe(true);
  expect(Object.isFrozen(before)).toBe(true);
}

describe('Identity Session Family values', (): void => {
  it.each([
    '00000000-0000-7000-8000-000000000000',
    SESSION_ID,
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ])('retains a canonical lowercase UUIDv7 Session id: %s', (sessionId): void => {
    expect(parseIdentitySessionId(sessionId)).toBe(sessionId);
  });

  it.each([
    ['uppercase hexadecimal', '01890F3A-8BCD-7DEF-8ABC-0123456789AB'],
    ['UUIDv4', '01890f3a-8bcd-4def-8abc-0123456789ab'],
    ['non-RFC variant', '01890f3a-8bcd-7def-7abc-0123456789ab'],
    ['missing separators', '01890f3a8bcd7def8abc0123456789ab'],
    ['leading whitespace', ` ${SESSION_ID}`],
    ['trailing whitespace', `${SESSION_ID} `],
    ['sensitive non-UUID', 'session-secret-value'],
    ['non-string', 7],
    ['null', null],
  ])('rejects a Session id with %s', (_scenario, sessionId): void => {
    expect(() => parseIdentitySessionId(sessionId)).toThrow(InvalidIdentitySessionIdError);
  });

  it.each([
    MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    3_600,
    MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
  ])('retains supported refresh-idle lifetime %d', (seconds): void => {
    expect(parseIdentityRefreshIdleLifetimeSeconds(seconds)).toBe(seconds);
  });

  it.each([
    0,
    MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS + 1,
    900.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '900',
    null,
  ])('rejects unsupported refresh-idle lifetime %p', (seconds): void => {
    expect(() => parseIdentityRefreshIdleLifetimeSeconds(seconds)).toThrow(
      InvalidIdentityRefreshIdleLifetimeSecondsError,
    );
  });

  it.each([
    MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
    604_800,
    MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
  ])('retains supported refresh-absolute lifetime %d', (seconds): void => {
    expect(parseIdentityRefreshAbsoluteLifetimeSeconds(seconds)).toBe(seconds);
  });

  it.each([
    MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS - 1,
    MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS + 1,
    86_400.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    '86400',
    undefined,
  ])('rejects unsupported refresh-absolute lifetime %p', (seconds): void => {
    expect(() => parseIdentityRefreshAbsoluteLifetimeSeconds(seconds)).toThrow(
      InvalidIdentityRefreshAbsoluteLifetimeSecondsError,
    );
  });

  it('publishes exact frozen state and reason registries with exact lifetime bounds', (): void => {
    expect(IDENTITY_SESSION_FAMILY_AUTHENTICATION_STATES).toEqual([
      'AUTHENTICATING',
      'ABSOLUTELY_EXPIRED',
      'REVOKED',
    ]);
    expect(IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS).toEqual([
      'LOGOUT',
      'SESSION_LIMIT_REACHED',
      'ACCOUNT_SUSPENDED',
      'ACCOUNT_DEACTIVATED',
      'PASSWORD_REPLACED',
      'PASSWORD_REBOUND',
    ]);
    expect(IDENTITY_SESSION_FAMILY_CLOSED_REASONS).toEqual([
      ...IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS,
      'REFRESH_REUSE_DETECTED',
    ]);
    expect(Object.isFrozen(IDENTITY_SESSION_FAMILY_AUTHENTICATION_STATES)).toBe(true);
    expect(Object.isFrozen(IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS)).toBe(true);
    expect(Object.isFrozen(IDENTITY_SESSION_FAMILY_CLOSED_REASONS)).toBe(true);
    expect(MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS).toBe(900);
    expect(MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS).toBe(86_400);
    expect(MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS).toBe(86_400);
    expect(MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS).toBe(2_592_000);
    expect(MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS).toBeLessThanOrEqual(
      MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
    );
  });

  it.each(IDENTITY_SESSION_FAMILY_CLOSED_REASONS)(
    'retains supported closed reason %s',
    (reason): void => {
      expect(parseIdentitySessionFamilyClosedReason(reason)).toBe(reason);
    },
  );

  it.each(IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS)(
    'retains generic revocation reason %s',
    (reason): void => {
      expect(parseIdentitySessionFamilyGenericRevocationReason(reason)).toBe(reason);
    },
  );

  it('reserves refresh reuse for the future credential-owned transition', (): void => {
    expect(() =>
      parseIdentitySessionFamilyGenericRevocationReason('REFRESH_REUSE_DETECTED'),
    ).toThrow(InvalidIdentitySessionFamilyGenericRevocationReasonError);
  });

  it('uses fixed cause-free value errors without exposing rejected values', (): void => {
    expectFixedSafeError(
      () => parseIdentitySessionId('session-secret-value'),
      InvalidIdentitySessionIdError,
      ['session-secret-value'],
    );
    expectFixedSafeError(
      () => parseIdentityRefreshIdleLifetimeSeconds('idle-secret-value'),
      InvalidIdentityRefreshIdleLifetimeSecondsError,
      ['idle-secret-value'],
    );
    expectFixedSafeError(
      () => parseIdentityRefreshAbsoluteLifetimeSeconds('absolute-secret-value'),
      InvalidIdentityRefreshAbsoluteLifetimeSecondsError,
      ['absolute-secret-value'],
    );
    expectFixedSafeError(
      () => parseIdentitySessionFamilyClosedReason('closed-secret-value'),
      InvalidIdentitySessionFamilyClosedReasonError,
      ['closed-secret-value'],
    );
    expectFixedSafeError(
      () => parseIdentitySessionFamilyGenericRevocationReason('revocation-secret-value'),
      InvalidIdentitySessionFamilyGenericRevocationReasonError,
      ['revocation-secret-value'],
    );
  });
});

describe('IdentitySessionFamily creation', (): void => {
  it('creates exact minimum-lifetime state and one frozen secret-free fact', (): void => {
    const result = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: CREATED_AT,
    });

    expect(result).toEqual({
      kind: 'changed',
      sessionFamily: result.sessionFamily,
      facts: [
        {
          type: 'SESSION_FAMILY_CREATED',
          sessionId: SESSION_ID,
          accountId: ACCOUNT_ID,
          state: 'AUTHENTICATING',
          version: 1,
          occurredAt: CREATED_AT,
        },
      ],
    });
    expect(result.sessionFamily.toSnapshot()).toEqual(initialSnapshot());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sessionFamily)).toBe(true);
    expect(Object.isFrozen(result.sessionFamily.toSnapshot())).toBe(true);
    expectFrozenSafeFacts(result.facts);
    expect(Object.keys(result.sessionFamily)).toEqual([]);
    expect(JSON.stringify(result.sessionFamily)).toBe('{}');
  });

  it('derives exact maximum-lifetime deadlines without losing microseconds', (): void => {
    const result = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshIdleLifetimeSeconds: MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      refreshAbsoluteLifetimeSeconds: MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: CREATED_AT,
    });

    expect(result.sessionFamily.toSnapshot()).toEqual(
      initialSnapshot({
        refreshIdleExpiresAt: '2026-08-24T10:00:00.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    );
  });

  it('allows equal idle and absolute lifetimes and derives one equal deadline', (): void => {
    const sessionFamily = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshIdleLifetimeSeconds: MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: CREATED_AT,
    }).sessionFamily;

    expect(sessionFamily.toSnapshot()).toMatchObject({
      refreshIdleExpiresAt: ABSOLUTE_EXPIRES_AT,
      refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    });
  });

  it('uses Gregorian leap-day arithmetic across a calendar boundary', (): void => {
    const sessionFamily = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: '2024-02-28T23:59:59.123456Z',
    }).sessionFamily;

    expect(sessionFamily.toSnapshot()).toMatchObject({
      createdAt: '2024-02-28T23:59:59.123456Z',
      lastRotatedAt: '2024-02-28T23:59:59.123456Z',
      refreshIdleExpiresAt: '2024-02-29T00:14:59.123456Z',
      refreshAbsoluteExpiresAt: '2024-02-29T23:59:59.123456Z',
    });
  });

  it('rejects an absolute deadline beyond the MySQL range with a fixed error', (): void => {
    const occurredAt = '9999-12-31T00:00:00.654321Z';

    expectFixedSafeError(
      () =>
        IdentitySessionFamily.create({
          id: SESSION_ID,
          accountId: ACCOUNT_ID,
          refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
          refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
          occurredAt,
        }),
      IdentitySessionFamilyDeadlineOverflowError,
      [occurredAt],
    );
  });

  it.each([
    [
      'invalid occurrence time',
      {
        id: 'session-secret-id',
        accountId: 'account-secret-id',
        refreshIdleLifetimeSeconds: 'idle-secret',
        refreshAbsoluteLifetimeSeconds: 'absolute-secret',
        occurredAt: 'time-secret',
      },
      InvalidIdentityInstantError,
    ],
    [
      'invalid Session id',
      {
        id: 'session-secret-id',
        accountId: ACCOUNT_ID,
        refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
        refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
        occurredAt: CREATED_AT,
      },
      InvalidIdentitySessionIdError,
    ],
    [
      'invalid Account id',
      {
        id: SESSION_ID,
        accountId: 'account-secret-id',
        refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
        refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
        occurredAt: CREATED_AT,
      },
      InvalidIdentityAccountIdError,
    ],
    [
      'invalid idle lifetime',
      {
        id: SESSION_ID,
        accountId: ACCOUNT_ID,
        refreshIdleLifetimeSeconds: 'idle-secret',
        refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
        occurredAt: CREATED_AT,
      },
      InvalidIdentityRefreshIdleLifetimeSecondsError,
    ],
    [
      'invalid absolute lifetime',
      {
        id: SESSION_ID,
        accountId: ACCOUNT_ID,
        refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
        refreshAbsoluteLifetimeSeconds: 'absolute-secret',
        occurredAt: CREATED_AT,
      },
      InvalidIdentityRefreshAbsoluteLifetimeSecondsError,
    ],
  ] as const)(
    'uses stable validation precedence for an %s',
    (_scenario, input, expectedClass): void => {
      expectFixedSafeError(() => IdentitySessionFamily.create(input), expectedClass, [
        'session-secret-id',
        'account-secret-id',
        'idle-secret',
        'absolute-secret',
        'time-secret',
      ]);
    },
  );

  it('does not retain or expose the mutable caller-owned input', (): void => {
    const input = {
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: CREATED_AT,
    };
    const sessionFamily = IdentitySessionFamily.create(input).sessionFamily;
    input.id = 'changed-outside';
    input.refreshIdleLifetimeSeconds = MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS;

    expect(sessionFamily.toSnapshot()).toEqual(initialSnapshot());
    expect(() => {
      (sessionFamily.toSnapshot() as { closedReason: string | null }).closedReason = 'LOGOUT';
    }).toThrow(TypeError);
    expect(sessionFamily.toSnapshot()).toEqual(initialSnapshot());
  });
});

describe('IdentitySessionFamily strict rehydration', (): void => {
  it.each([
    ['initial open family', initialSnapshot()],
    ['directly revoked family', directlyRevokedSnapshot()],
    ['rotated open family', rotatedSnapshot()],
    ['absolute-capped rotated family', cappedRotatedSnapshot()],
    ['retained naturally expired family', expiredSnapshot()],
    ['refresh-reuse-revoked rotated family', reuseRevokedSnapshot()],
  ] as const)('rehydrates a reachable %s without producing facts', (_scenario, raw): void => {
    const sessionFamily = IdentitySessionFamily.rehydrate(raw);

    expect(sessionFamily.toSnapshot()).toEqual(raw);
    expect(Object.isFrozen(sessionFamily)).toBe(true);
    expect(Object.isFrozen(sessionFamily.toSnapshot())).toBe(true);
    expect(Object.keys(sessionFamily)).toEqual([]);
    expect(JSON.stringify(sessionFamily)).toBe('{}');
  });

  it('rehydrates exact initial and rotated lifetime boundaries', (): void => {
    const initialMaximum = initialSnapshot({
      refreshIdleExpiresAt: '2026-08-24T10:00:00.000001Z',
      refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
    });
    const rotatedMaximum = rotatedSnapshot({
      refreshIdleExpiresAt: '2026-08-24T10:30:00.000002Z',
      refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
    });

    expect(IdentitySessionFamily.rehydrate(initialMaximum).toSnapshot()).toEqual(initialMaximum);
    expect(IdentitySessionFamily.rehydrate(rotatedMaximum).toSnapshot()).toEqual(rotatedMaximum);
    expect(IdentitySessionFamily.rehydrate(cappedRotatedSnapshot()).toSnapshot()).toEqual(
      cappedRotatedSnapshot(),
    );
  });

  it.each([
    [
      'version-2 open family one microsecond before its one-rotation bound',
      rotatedSnapshot({
        version: 2,
        lastRotatedAt: '2026-08-24T10:00:00.000000Z',
        refreshIdleExpiresAt: '2026-08-24T10:15:00.000000Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'version-3 revoked family one microsecond before its one-rotation bound',
      rotatedSnapshot({
        version: 3,
        lastRotatedAt: '2026-08-24T10:00:00.000000Z',
        refreshIdleExpiresAt: '2026-08-24T10:15:00.000000Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
        revokedAt: '2026-08-24T10:00:00.000000Z',
        closedReason: 'LOGOUT',
      }),
    ],
    [
      'version-3 open family one microsecond before its two-rotation bound',
      rotatedSnapshot({
        version: 3,
        lastRotatedAt: '2026-08-25T10:00:00.000000Z',
        refreshIdleExpiresAt: '2026-08-25T10:15:00.000000Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'version-31 open family at the thirty-rotation threshold',
      cappedRotatedSnapshot({
        version: 31,
        lastRotatedAt: '2026-09-22T09:59:59.000001Z',
        refreshIdleExpiresAt: '2026-09-22T10:00:00.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'version-32 revoked family at the thirty-rotation threshold',
      cappedRotatedSnapshot({
        version: 32,
        lastRotatedAt: '2026-09-22T09:59:59.000001Z',
        refreshIdleExpiresAt: '2026-09-22T10:00:00.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
        revokedAt: '2026-09-22T10:00:00.000001Z',
        closedReason: 'LOGOUT',
      }),
    ],
  ] as const)('accepts a reachable %s', (_scenario, raw): void => {
    expect(IdentitySessionFamily.rehydrate(raw).toSnapshot()).toEqual(raw);
  });

  it('copies a mutable persistence record into frozen state', (): void => {
    const raw = { ...rotatedSnapshot() };
    const sessionFamily = IdentitySessionFamily.rehydrate(raw);
    raw.version = 99;
    raw.lastRotatedAt = 'persistence-mutated-time';

    expect(sessionFamily.toSnapshot()).toEqual(rotatedSnapshot());
    expect(() => {
      (sessionFamily.toSnapshot() as { version: number }).version = 99;
    }).toThrow(TypeError);
    expect(sessionFamily.toSnapshot()).toEqual(rotatedSnapshot());
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing required key', { id: SESSION_ID }],
    ['additional key', { ...initialSnapshot(), internalSecret: 'persistence-secret' }],
    ['invalid Session id', initialSnapshot({ id: 'persistence-session-secret' })],
    ['invalid Account id', initialSnapshot({ accountId: 'persistence-account-secret' })],
    ['invalid version', initialSnapshot({ version: 0 })],
    ['invalid creation time', initialSnapshot({ createdAt: 'persistence-time-secret' })],
    ['invalid last-rotation time', initialSnapshot({ lastRotatedAt: 'not-an-instant' })],
    ['invalid idle deadline', initialSnapshot({ refreshIdleExpiresAt: 'not-an-instant' })],
    ['invalid absolute deadline', initialSnapshot({ refreshAbsoluteExpiresAt: 'not-an-instant' })],
    ['invalid revocation time', directlyRevokedSnapshot({ revokedAt: 'not-an-instant' })],
    [
      'unknown closed reason',
      directlyRevokedSnapshot({ closedReason: 'persistence-reason-secret' }),
    ],
    ['last rotation before creation', initialSnapshot({ lastRotatedAt: BEFORE_CREATED_AT })],
    ['idle deadline equal to last rotation', initialSnapshot({ refreshIdleExpiresAt: CREATED_AT })],
    [
      'idle deadline after absolute deadline',
      initialSnapshot({ refreshIdleExpiresAt: '2026-08-24T10:00:01.000001Z' }),
    ],
    [
      'revocation before last rotation',
      rotatedSnapshot({
        version: 3,
        revokedAt: CREATED_AT,
        closedReason: 'LOGOUT',
      }),
    ],
    ['revocation time without reason', initialSnapshot({ version: 2, revokedAt: CREATED_AT })],
    ['revocation reason without time', initialSnapshot({ version: 2, closedReason: 'LOGOUT' })],
    ['version-1 revoked family', directlyRevokedSnapshot({ version: 1 })],
    [
      'version-1 rotated family',
      rotatedSnapshot({
        version: 1,
      }),
    ],
    [
      'version-2 family both rotated and revoked',
      directlyRevokedSnapshot({
        lastRotatedAt: ROTATED_AT,
        refreshIdleExpiresAt: ROTATED_IDLE_EXPIRES_AT,
        revokedAt: ROTATED_AT,
      }),
    ],
    [
      'version-2 refresh-reuse closure without a preceding rotation',
      directlyRevokedSnapshot({ closedReason: 'REFRESH_REUSE_DETECTED' }),
    ],
    [
      'version-2 open family rotating exactly at its one-rotation bound',
      rotatedSnapshot({
        version: 2,
        lastRotatedAt: '2026-08-24T10:00:00.000001Z',
        refreshIdleExpiresAt: '2026-08-24T10:15:00.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'version-2 open family rotating after its one-rotation bound',
      rotatedSnapshot({
        version: 2,
        lastRotatedAt: '2026-08-24T10:00:00.000002Z',
        refreshIdleExpiresAt: '2026-08-24T10:15:00.000002Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'version-3 revoked family rotating exactly at its one-rotation bound',
      rotatedSnapshot({
        version: 3,
        lastRotatedAt: '2026-08-24T10:00:00.000001Z',
        refreshIdleExpiresAt: '2026-08-24T10:15:00.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
        revokedAt: '2026-08-24T10:00:00.000001Z',
        closedReason: 'LOGOUT',
      }),
    ],
    [
      'version-3 revoked family rotating after its one-rotation bound',
      rotatedSnapshot({
        version: 3,
        lastRotatedAt: '2026-08-24T10:00:00.000002Z',
        refreshIdleExpiresAt: '2026-08-24T10:15:00.000002Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
        revokedAt: '2026-08-24T10:00:00.000002Z',
        closedReason: 'LOGOUT',
      }),
    ],
    [
      'version-3 open family rotating exactly at its two-rotation bound',
      rotatedSnapshot({
        version: 3,
        lastRotatedAt: '2026-08-25T10:00:00.000001Z',
        refreshIdleExpiresAt: '2026-08-25T10:15:00.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'absolute lifetime below one day',
      initialSnapshot({ refreshAbsoluteExpiresAt: '2026-08-24T09:59:59.000001Z' }),
    ],
    [
      'absolute lifetime above thirty days',
      initialSnapshot({
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:01.000001Z',
      }),
    ],
    [
      'absolute deadline with a different fractional second',
      initialSnapshot({ refreshAbsoluteExpiresAt: '2026-08-24T10:00:00.000002Z' }),
    ],
    [
      'initial idle lifetime below fifteen minutes',
      initialSnapshot({ refreshIdleExpiresAt: '2026-08-23T10:14:59.000001Z' }),
    ],
    [
      'initial idle lifetime above twenty-four hours',
      initialSnapshot({
        refreshIdleExpiresAt: '2026-08-24T10:00:01.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'initial idle deadline with a different fractional second',
      initialSnapshot({ refreshIdleExpiresAt: '2026-08-23T10:15:00.000002Z' }),
    ],
    [
      'uncapped rotated idle lifetime below fifteen minutes',
      rotatedSnapshot({ refreshIdleExpiresAt: '2026-08-23T10:44:59.000002Z' }),
    ],
    [
      'uncapped rotated idle lifetime above twenty-four hours',
      rotatedSnapshot({
        refreshIdleExpiresAt: '2026-08-24T10:30:01.000002Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
    [
      'uncapped rotated deadline with a different fractional second',
      rotatedSnapshot({ refreshIdleExpiresAt: '2026-08-23T10:45:00.000003Z' }),
    ],
    [
      'absolute-capped rotated lifetime below one whole second',
      cappedRotatedSnapshot({ lastRotatedAt: '2026-08-24T09:59:59.000002Z' }),
    ],
    [
      'absolute-capped rotated lifetime above twenty-four hours',
      cappedRotatedSnapshot({
        lastRotatedAt: '2026-08-23T10:30:00.000001Z',
        refreshIdleExpiresAt: '2026-09-22T10:00:00.000001Z',
        refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
      }),
    ],
  ] as const)(
    'rejects an unreachable %s with one fixed cause-free error',
    (_scenario, raw): void => {
      const error = captureError(() => IdentitySessionFamily.rehydrate(raw));

      expect(error).toBeInstanceOf(InvalidIdentitySessionFamilyStateError);
      expect(error).toMatchObject({
        name: 'InvalidIdentitySessionFamilyStateError',
        message: 'Expected a valid Identity Session Family snapshot',
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(String(error)).not.toContain('persistence-secret');
      expect(String(error)).not.toContain('persistence-session-secret');
      expect(String(error)).not.toContain('persistence-account-secret');
      expect(String(error)).not.toContain('persistence-time-secret');
      expect(String(error)).not.toContain('persistence-reason-secret');
      expect(JSON.stringify(error)).not.toContain('persistence-secret');
    },
  );
});

describe('IdentitySessionFamily derived authentication state', (): void => {
  it.each([
    ['at creation', CREATED_AT, 'AUTHENTICATING'],
    ['one microsecond before absolute expiry', '2026-08-24T10:00:00.000000Z', 'AUTHENTICATING'],
    ['exactly at absolute expiry', ABSOLUTE_EXPIRES_AT, 'ABSOLUTELY_EXPIRED'],
    ['after absolute expiry', '2026-08-24T10:00:00.000002Z', 'ABSOLUTELY_EXPIRED'],
  ] as const)('derives %s as %s', (_scenario, observedAt, expectedState): void => {
    const sessionFamily = createSessionFamily();
    const before = sessionFamily.toSnapshot();

    expect(sessionFamily.authenticationStateAt({ observedAt })).toBe(expectedState);
    expect(sessionFamily.toSnapshot()).toBe(before);
  });

  it('ignores refresh-idle expiry when evaluating access authentication', (): void => {
    const sessionFamily = createSessionFamily();

    expect(sessionFamily.authenticationStateAt({ observedAt: INITIAL_IDLE_EXPIRES_AT })).toBe(
      'AUTHENTICATING',
    );
    expect(sessionFamily.authenticationStateAt({ observedAt: '2026-08-24T09:59:59.999999Z' })).toBe(
      'AUTHENTICATING',
    );
  });

  it('gives terminal revocation precedence over absolute expiry', (): void => {
    const sessionFamily = IdentitySessionFamily.rehydrate(
      directlyRevokedSnapshot({ revokedAt: '2026-08-25T10:00:00.000001Z' }),
    );

    expect(sessionFamily.authenticationStateAt({ observedAt: '2026-08-25T10:00:00.000001Z' })).toBe(
      'REVOKED',
    );
    expect(sessionFamily.authenticationStateAt({ observedAt: '2026-08-26T10:00:00.000001Z' })).toBe(
      'REVOKED',
    );
  });

  it('uses last rotation as the open-family observation high-water mark', (): void => {
    const sessionFamily = IdentitySessionFamily.rehydrate(rotatedSnapshot());

    expectSafeImmutableRejection(
      sessionFamily,
      () => sessionFamily.authenticationStateAt({ observedAt: CREATED_AT }),
      IdentitySessionFamilyTimestampRegressionError,
    );
    expect(sessionFamily.authenticationStateAt({ observedAt: ROTATED_AT })).toBe('AUTHENTICATING');
  });

  it('uses revocation time as the terminal observation high-water mark', (): void => {
    const revokedAt = '2026-08-25T10:00:00.000001Z';
    const sessionFamily = IdentitySessionFamily.rehydrate(directlyRevokedSnapshot({ revokedAt }));

    expectSafeImmutableRejection(
      sessionFamily,
      () => sessionFamily.authenticationStateAt({ observedAt: ABSOLUTE_EXPIRES_AT }),
      IdentitySessionFamilyTimestampRegressionError,
    );
    expect(sessionFamily.authenticationStateAt({ observedAt: revokedAt })).toBe('REVOKED');
  });

  it('defensively validates observation time before deriving state', (): void => {
    const sessionFamily = createSessionFamily();
    const rejectedValue = 'sensitive-observation-time';

    expectSafeImmutableRejection(
      sessionFamily,
      () => sessionFamily.authenticationStateAt({ observedAt: rejectedValue }),
      InvalidIdentityInstantError,
      [rejectedValue],
    );
  });
});

describe('IdentitySessionFamily generic revocation', (): void => {
  it.each(IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS)(
    'records terminal %s revocation with an exact frozen fact',
    (closedReason): void => {
      const original = createSessionFamily();
      const before = original.toSnapshot();
      const occurredAt = '2026-08-23T10:30:00.000002Z';
      const result = original.revoke({ closedReason, occurredAt });

      expect(result).toEqual({
        kind: 'changed',
        sessionFamily: result.sessionFamily,
        facts: [
          {
            type: 'SESSION_FAMILY_REVOKED',
            sessionId: SESSION_ID,
            accountId: ACCOUNT_ID,
            state: 'REVOKED',
            version: 2,
            occurredAt,
            closedReason,
          },
        ],
      });
      expect(result.sessionFamily.toSnapshot()).toEqual({
        ...before,
        version: 2,
        revokedAt: occurredAt,
        closedReason,
      });
      expect(result.sessionFamily).not.toBe(original);
      expect(original.toSnapshot()).toBe(before);
      expect(original.toSnapshot()).toEqual(initialSnapshot());
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.sessionFamily)).toBe(true);
      expect(Object.isFrozen(result.sessionFamily.toSnapshot())).toBe(true);
      expectFrozenSafeFacts(result.facts);
    },
  );

  it('allows revocation at the current mutation instant', (): void => {
    const original = createSessionFamily();
    const result = original.revoke({ closedReason: 'LOGOUT', occurredAt: CREATED_AT });

    expect(result.kind).toBe('changed');
    expect(result.sessionFamily.toSnapshot()).toMatchObject({
      version: 2,
      revokedAt: CREATED_AT,
      closedReason: 'LOGOUT',
    });
  });

  it('allows terminal revocation after idle and absolute expiry', (): void => {
    const original = createSessionFamily();
    const occurredAt = '2026-08-25T10:00:00.000001Z';
    const result = original.revoke({ closedReason: 'LOGOUT', occurredAt });

    expect(result.kind).toBe('changed');
    expect(result.sessionFamily.toSnapshot()).toMatchObject({
      version: 2,
      revokedAt: occurredAt,
      closedReason: 'LOGOUT',
    });
    expect(result.sessionFamily.authenticationStateAt({ observedAt: occurredAt })).toBe('REVOKED');
  });

  it('keeps the first terminal cause and returns the original terminal family', (): void => {
    const first = createSessionFamily().revoke({
      closedReason: 'LOGOUT',
      occurredAt: ROTATED_AT,
    });
    const terminal = first.sessionFamily;
    const before = terminal.toSnapshot();
    const repeated = terminal.revoke({
      closedReason: 'PASSWORD_REPLACED',
      occurredAt: 'malformed-no-op-time',
    });

    expect(repeated).toEqual({ kind: 'unchanged', sessionFamily: terminal, facts: [] });
    expect(repeated.sessionFamily).toBe(terminal);
    expect(repeated.sessionFamily.toSnapshot()).toBe(before);
    expect(repeated.sessionFamily.toSnapshot()).toMatchObject({
      version: 2,
      revokedAt: ROTATED_AT,
      closedReason: 'LOGOUT',
    });
    expect(Object.isFrozen(repeated)).toBe(true);
    expectFrozenSafeFacts(repeated.facts);
  });

  it('keeps terminal revocation idempotent at maximum version without parsing occurrence', (): void => {
    const terminal = IdentitySessionFamily.rehydrate(
      directlyRevokedSnapshot({
        version: MAX_IDENTITY_AGGREGATE_VERSION,
        revokedAt: ROTATED_AT,
      }),
    );
    const before = terminal.toSnapshot();
    const repeated = terminal.revoke({
      closedReason: 'ACCOUNT_DEACTIVATED',
      occurredAt: 'malformed-no-op-time',
    });

    expect(repeated).toEqual({ kind: 'unchanged', sessionFamily: terminal, facts: [] });
    expect(repeated.sessionFamily).toBe(terminal);
    expect(repeated.sessionFamily.toSnapshot()).toBe(before);
    expect(Object.isFrozen(repeated)).toBe(true);
    expectFrozenSafeFacts(repeated.facts);
  });

  it('rejects REFRESH_REUSE_DETECTED before mutation or idempotent handling', (): void => {
    const open = createSessionFamily();
    const terminal = IdentitySessionFamily.rehydrate(directlyRevokedSnapshot());

    for (const sessionFamily of [open, terminal]) {
      expectSafeImmutableRejection(
        sessionFamily,
        () =>
          sessionFamily.revoke({
            closedReason: 'REFRESH_REUSE_DETECTED',
            occurredAt: 'malformed-occurrence',
          }),
        InvalidIdentitySessionFamilyGenericRevocationReasonError,
      );
    }
  });

  it('rejects aggregate-version exhaustion without partially revoking', (): void => {
    const sessionFamily = IdentitySessionFamily.rehydrate(
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION }),
    );

    expectSafeImmutableRejection(
      sessionFamily,
      () => sessionFamily.revoke({ closedReason: 'LOGOUT', occurredAt: ROTATED_AT }),
      IdentityAggregateVersionExhaustedError,
    );
  });

  it('enforces reason, no-op lifecycle, occurrence, then version-capacity precedence', (): void => {
    const maximum = IdentitySessionFamily.rehydrate(
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION }),
    );

    expectSafeImmutableRejection(
      maximum,
      () => maximum.revoke({ closedReason: 'invalid-reason', occurredAt: BEFORE_CREATED_AT }),
      InvalidIdentitySessionFamilyGenericRevocationReasonError,
      ['invalid-reason'],
    );
    expectSafeImmutableRejection(
      maximum,
      () => maximum.revoke({ closedReason: 'LOGOUT', occurredAt: 'invalid-time' }),
      InvalidIdentityInstantError,
      ['invalid-time'],
    );
    expectSafeImmutableRejection(
      maximum,
      () => maximum.revoke({ closedReason: 'LOGOUT', occurredAt: BEFORE_CREATED_AT }),
      IdentitySessionFamilyTimestampRegressionError,
    );
    expectSafeImmutableRejection(
      maximum,
      () => maximum.revoke({ closedReason: 'LOGOUT', occurredAt: ROTATED_AT }),
      IdentityAggregateVersionExhaustedError,
    );
  });
});

// Compile-time assertions: public parsers and aggregate snapshots retain their domain brands.
const _sessionId: IdentitySessionId = parseIdentitySessionId(SESSION_ID);
const _idleLifetime: IdentityRefreshIdleLifetimeSeconds = parseIdentityRefreshIdleLifetimeSeconds(
  MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
);
const _absoluteLifetime: IdentityRefreshAbsoluteLifetimeSeconds =
  parseIdentityRefreshAbsoluteLifetimeSeconds(MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS);
const _sessionSnapshot: IdentitySessionFamilySnapshot = createSessionFamily().toSnapshot();
void _sessionId;
void _idleLifetime;
void _absoluteLifetime;
void _sessionSnapshot;
