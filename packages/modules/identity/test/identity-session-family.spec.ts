import { InvalidIdentityAccountIdError } from '../src/domain/identity-account.values';
import { IdentityAccount } from '../src/domain/identity-account';
import { IdentityRefreshCredential } from '../src/domain/identity-refresh-credential';
import {
  InvalidIdentityRefreshCredentialIdError,
  MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE,
} from '../src/domain/identity-refresh-credential.values';
import {
  IdentitySessionFamilyDeadlineOverflowError,
  IdentitySessionFamilyRefreshCapacityExhaustedError,
  IdentitySessionFamilyRefreshSuccessorConflictError,
  IdentitySessionFamilyRefreshTimestampRegressionError,
  IdentitySessionFamilyTimestampRegressionError,
  InvalidIdentitySessionFamilyRefreshStateError,
  InvalidIdentitySessionFamilyStateError,
} from '../src/domain/identity-session-family.errors';
import {
  IdentitySessionFamily,
  type PresentIdentityRefreshCredentialInput,
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
  InvalidIdentityInstantError,
  MAX_IDENTITY_AGGREGATE_VERSION,
} from '../src/domain/identity-values';

const SESSION_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const INITIAL_REFRESH_CREDENTIAL_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const SUCCESSOR_REFRESH_CREDENTIAL_ID = '01890f3a-8bcd-7def-8abc-1123456789ab';
const SECOND_SUCCESSOR_REFRESH_CREDENTIAL_ID = '01890f3a-8bcd-7def-9abc-1123456789ab';
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

type RawRefreshCredentialSnapshot = Readonly<{
  id: unknown;
  sessionId: unknown;
  sequence: unknown;
  issuedAt: unknown;
  expiresAt: unknown;
  consumedAt: unknown;
  successorId: unknown;
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

function createSessionBundle(): ReturnType<typeof IdentitySessionFamily.create> {
  return IdentitySessionFamily.create({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
    refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
    occurredAt: CREATED_AT,
  });
}

function createSessionFamily(): IdentitySessionFamily {
  return createSessionBundle().sessionFamily;
}

function accountSnapshot(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id: ACCOUNT_ID,
    loginName: 'system.admin',
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-08-23T09:00:00.000001Z',
    updatedAt: '2026-08-23T09:00:00.000001Z',
    suspendedAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

function activeAccount(overrides: Readonly<Record<string, unknown>> = {}): IdentityAccount {
  return IdentityAccount.rehydrate(accountSnapshot(overrides));
}

function suspendedAccount(): IdentityAccount {
  return IdentityAccount.rehydrate(
    accountSnapshot({
      status: 'SUSPENDED',
      version: 2,
      updatedAt: CREATED_AT,
      suspendedAt: CREATED_AT,
    }),
  );
}

function deactivatedAccount(): IdentityAccount {
  return IdentityAccount.rehydrate(
    accountSnapshot({
      status: 'DEACTIVATED',
      version: 2,
      updatedAt: CREATED_AT,
      deactivatedAt: CREATED_AT,
    }),
  );
}

function refreshCredentialSnapshot(
  overrides: Partial<RawRefreshCredentialSnapshot> = {},
): RawRefreshCredentialSnapshot {
  return {
    id: INITIAL_REFRESH_CREDENTIAL_ID,
    sessionId: SESSION_ID,
    sequence: 1,
    issuedAt: CREATED_AT,
    expiresAt: INITIAL_IDLE_EXPIRES_AT,
    consumedAt: null,
    successorId: null,
    ...overrides,
  };
}

function refreshCredential(
  overrides: Partial<RawRefreshCredentialSnapshot> = {},
): IdentityRefreshCredential {
  return IdentityRefreshCredential.rehydrate(refreshCredentialSnapshot(overrides));
}

function presentationInput(
  account: unknown,
  presentedRefreshCredential: unknown,
  overrides: Partial<PresentIdentityRefreshCredentialInput> = {},
): PresentIdentityRefreshCredentialInput {
  return {
    account,
    presentedRefreshCredential,
    occurredAt: '2026-08-23T10:05:00.000002Z',
    successorRefreshCredentialId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
    refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    ...overrides,
  };
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

function expectSafePresentationError(
  sessionFamily: IdentitySessionFamily,
  account: IdentityAccount,
  credential: IdentityRefreshCredential,
  operation: () => unknown,
  expectedClass: ErrorClass,
): void {
  const familyBefore = sessionFamily.toSnapshot();
  const accountBefore = account.toSnapshot();
  const credentialBefore = credential.toSnapshot();

  expectFixedSafeError(operation, expectedClass);
  expect(sessionFamily.toSnapshot()).toBe(familyBefore);
  expect(account.toSnapshot()).toBe(accountBefore);
  expect(credential.toSnapshot()).toBe(credentialBefore);
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
      initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
      refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: CREATED_AT,
    });

    expect(result).toEqual({
      kind: 'changed',
      sessionFamily: result.sessionFamily,
      initialRefreshCredential: result.initialRefreshCredential,
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
    expect(result.initialRefreshCredential.toSnapshot()).toEqual({
      id: INITIAL_REFRESH_CREDENTIAL_ID,
      sessionId: SESSION_ID,
      sequence: 1,
      issuedAt: CREATED_AT,
      expiresAt: INITIAL_IDLE_EXPIRES_AT,
      consumedAt: null,
      successorId: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sessionFamily)).toBe(true);
    expect(Object.isFrozen(result.sessionFamily.toSnapshot())).toBe(true);
    expect(Object.isFrozen(result.initialRefreshCredential)).toBe(true);
    expect(Object.isFrozen(result.initialRefreshCredential.toSnapshot())).toBe(true);
    expectFrozenSafeFacts(result.facts);
    expect(Object.keys(result.sessionFamily)).toEqual([]);
    expect(JSON.stringify(result.sessionFamily)).toBe('{}');
  });

  it('derives exact maximum-lifetime deadlines without losing microseconds', (): void => {
    const result = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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

  it('allows separately branded family and initial credential IDs to share bytes', (): void => {
    const result = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      initialRefreshCredentialId: SESSION_ID,
      refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: CREATED_AT,
    });

    expect(result.sessionFamily.toSnapshot().id).toBe(SESSION_ID);
    expect(result.initialRefreshCredential.toSnapshot()).toMatchObject({
      id: SESSION_ID,
      sessionId: SESSION_ID,
    });
  });

  it('allows equal idle and absolute lifetimes and derives one equal deadline', (): void => {
    const sessionFamily = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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
      initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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
          initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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
        initialRefreshCredentialId: 'credential-secret-id',
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
        initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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
        initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
        refreshIdleLifetimeSeconds: MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
        refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
        occurredAt: CREATED_AT,
      },
      InvalidIdentityAccountIdError,
    ],
    [
      'invalid initial Refresh Credential id',
      {
        id: SESSION_ID,
        accountId: ACCOUNT_ID,
        initialRefreshCredentialId: 'credential-secret-id',
        refreshIdleLifetimeSeconds: 'idle-secret',
        refreshAbsoluteLifetimeSeconds: 'absolute-secret',
        occurredAt: CREATED_AT,
      },
      InvalidIdentityRefreshCredentialIdError,
    ],
    [
      'invalid idle lifetime',
      {
        id: SESSION_ID,
        accountId: ACCOUNT_ID,
        initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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
        initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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
        'credential-secret-id',
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
      initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
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
    [
      'open family consuming the terminal reserved version',
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION }),
    ],
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

describe('IdentitySessionFamily combined refresh reachability', (): void => {
  it('rejects plain-object aggregate and entity impostors before parsing time', (): void => {
    const sessionFamily = createSessionFamily();
    const account = activeAccount();
    const credential = refreshCredential();

    expectFixedSafeError(
      () =>
        sessionFamily.presentRefreshCredential(
          presentationInput(account.toSnapshot(), credential, { occurredAt: 'invalid-time' }),
        ),
      InvalidIdentitySessionFamilyRefreshStateError,
    );
    expectFixedSafeError(
      () =>
        sessionFamily.presentRefreshCredential(
          presentationInput(account, credential.toSnapshot(), { occurredAt: 'invalid-time' }),
        ),
      InvalidIdentitySessionFamilyRefreshStateError,
    );
  });

  it('collapses forged, hostile Proxy, and revoked Proxy locked inputs to one safe state error', (): void => {
    const sessionFamily = createSessionFamily();
    const familyBefore = sessionFamily.toSnapshot();
    const validAccount = activeAccount();
    const accountBefore = validAccount.toSnapshot();
    const validCredential = refreshCredential();
    const credentialBefore = validCredential.toSnapshot();
    const hostileSecret = 'hostile-locked-refresh-proxy-secret';
    let hostileTrapCalls = 0;
    const hostileAccount = new Proxy(validAccount, {
      get(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
      getPrototypeOf(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
    });
    const hostileCredential = new Proxy(validCredential, {
      get(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
      getPrototypeOf(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
    });
    const revokedAccount = Proxy.revocable(validAccount, {});
    const revokedCredential = Proxy.revocable(validCredential, {});
    revokedAccount.revoke();
    revokedCredential.revoke();
    const scenarios: readonly (readonly [unknown, unknown])[] = [
      [Object.create(IdentityAccount.prototype) as unknown, validCredential],
      [hostileAccount, validCredential],
      [revokedAccount.proxy, validCredential],
      [validAccount, Object.create(IdentityRefreshCredential.prototype) as unknown],
      [validAccount, hostileCredential],
      [validAccount, revokedCredential.proxy],
    ];

    for (const [account, credential] of scenarios) {
      expectFixedSafeError(
        () =>
          sessionFamily.presentRefreshCredential(
            presentationInput(account, credential, { occurredAt: 'invalid-time' }),
          ),
        InvalidIdentitySessionFamilyRefreshStateError,
        [hostileSecret],
      );
    }

    expect(hostileTrapCalls).toBe(0);
    expect(sessionFamily.toSnapshot()).toBe(familyBefore);
    expect(validAccount.toSnapshot()).toBe(accountBefore);
    expect(validCredential.toSnapshot()).toBe(credentialBefore);
  });

  it.each([
    [
      'Account owned by another identity',
      createSessionFamily(),
      activeAccount({ id: OTHER_ACCOUNT_ID }),
      refreshCredential(),
    ],
    [
      'Account created after the family',
      createSessionFamily(),
      activeAccount({
        createdAt: '2026-08-23T10:00:00.000002Z',
        updatedAt: '2026-08-23T10:00:00.000002Z',
      }),
      refreshCredential(),
    ],
    [
      'credential owned by another family',
      createSessionFamily(),
      activeAccount(),
      refreshCredential({ sessionId: SECOND_SUCCESSOR_REFRESH_CREDENTIAL_ID }),
    ],
    [
      'credential sequence above the current family generation',
      createSessionFamily(),
      activeAccount(),
      refreshCredential({ sequence: 2 }),
    ],
    [
      'sequence-1 credential issued before family creation',
      createSessionFamily(),
      activeAccount(),
      refreshCredential({
        issuedAt: '2026-08-23T09:00:00.000001Z',
        expiresAt: '2026-08-23T09:15:00.000001Z',
      }),
    ],
    [
      'sequence-1 credential issued after family creation',
      createSessionFamily(),
      activeAccount(),
      refreshCredential({
        issuedAt: '2026-08-23T10:00:01.000001Z',
        expiresAt: '2026-08-23T10:15:01.000001Z',
      }),
    ],
    [
      'historical credential left unconsumed',
      IdentitySessionFamily.rehydrate(rotatedSnapshot()),
      activeAccount(),
      refreshCredential(),
    ],
    [
      'current credential already consumed',
      createSessionFamily(),
      activeAccount(),
      refreshCredential({
        consumedAt: CREATED_AT,
        successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    ],
    [
      'historical consumption after last rotation',
      IdentitySessionFamily.rehydrate(rotatedSnapshot()),
      activeAccount(),
      refreshCredential({
        expiresAt: ABSOLUTE_EXPIRES_AT,
        consumedAt: '2026-08-23T10:31:00.000003Z',
        successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    ],
    [
      'later short credential not capped by family absolute expiry',
      IdentitySessionFamily.rehydrate(rotatedSnapshot({ version: 3 })),
      activeAccount(),
      refreshCredential({
        sequence: 2,
        issuedAt: '2026-08-23T10:10:00.000002Z',
        expiresAt: '2026-08-23T10:10:01.000003Z',
        consumedAt: '2026-08-23T10:10:00.000002Z',
        successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    ],
    [
      'sequence-2 issuance exactly at its strict one-day bound',
      IdentitySessionFamily.rehydrate(
        rotatedSnapshot({
          version: 3,
          lastRotatedAt: '2026-08-24T12:00:00.000001Z',
          refreshIdleExpiresAt: '2026-08-24T12:15:00.000001Z',
          refreshAbsoluteExpiresAt: '2026-09-22T10:00:00.000001Z',
        }),
      ),
      activeAccount(),
      refreshCredential({
        sequence: 2,
        issuedAt: '2026-08-24T10:00:00.000001Z',
        expiresAt: '2026-08-24T10:15:00.000001Z',
        consumedAt: '2026-08-24T10:01:00.000001Z',
        successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    ],
    [
      'historical expiry beyond the family absolute deadline',
      IdentitySessionFamily.rehydrate(
        rotatedSnapshot({
          version: 3,
          lastRotatedAt: '2026-08-23T11:00:00.000001Z',
          refreshIdleExpiresAt: '2026-08-23T11:15:00.000001Z',
        }),
      ),
      activeAccount(),
      refreshCredential({
        sequence: 2,
        issuedAt: '2026-08-23T10:30:00.000001Z',
        expiresAt: '2026-08-24T10:30:00.000001Z',
        consumedAt: '2026-08-23T10:31:00.000001Z',
        successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    ],
  ] as const)(
    'rejects %s as one fixed combined-state error',
    (_scenario, sessionFamily, account, credential): void => {
      expectSafePresentationError(
        sessionFamily,
        account,
        credential,
        () =>
          sessionFamily.presentRefreshCredential(
            presentationInput(account, credential, { occurredAt: 'invalid-time' }),
          ),
        InvalidIdentitySessionFamilyRefreshStateError,
      );
    },
  );

  it('accepts a later one-second credential only at the absolute cap', (): void => {
    const sessionFamily = IdentitySessionFamily.rehydrate(cappedRotatedSnapshot());
    const account = activeAccount();
    const credential = refreshCredential({
      id: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      sequence: 2,
      issuedAt: '2026-08-24T09:59:59.000001Z',
      expiresAt: ABSOLUTE_EXPIRES_AT,
    });
    const result = sessionFamily.presentRefreshCredential(
      presentationInput(account, credential, {
        occurredAt: '2026-08-24T09:59:59.000001Z',
        successorRefreshCredentialId: SECOND_SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    );

    expect(result.kind).toBe('rotated');
  });

  it('keeps a current sequence-3 credential reachable when its issuance bound overflows year 9999', (): void => {
    const nearRangeEnd = '9999-12-30T00:00:00.000001Z';
    const sessionFamily = IdentitySessionFamily.rehydrate(
      initialSnapshot({
        version: 3,
        createdAt: nearRangeEnd,
        lastRotatedAt: nearRangeEnd,
        refreshIdleExpiresAt: '9999-12-30T00:15:00.000001Z',
        refreshAbsoluteExpiresAt: '9999-12-31T00:00:00.000001Z',
      }),
    );
    const account = activeAccount({
      createdAt: '9999-12-29T23:59:59.000001Z',
      updatedAt: '9999-12-29T23:59:59.000001Z',
    });
    const credential = refreshCredential({
      sequence: 3,
      issuedAt: nearRangeEnd,
      expiresAt: '9999-12-30T00:15:00.000001Z',
    });

    const result = sessionFamily.presentRefreshCredential(
      presentationInput(account, credential, { occurredAt: nearRangeEnd }),
    );

    expect(result.kind).toBe('rotated');
    if (result.kind === 'rotated') {
      expect(result.sessionFamily.toSnapshot().version).toBe(4);
      expect(result.successorRefreshCredential.toSnapshot().sequence).toBe(4);
    }
  });

  it('keeps a consumed sequence-2 credential reachable when its consumption bound overflows year 9999', (): void => {
    const nearRangeEnd = '9999-12-30T00:00:00.000001Z';
    const sessionFamily = IdentitySessionFamily.rehydrate(
      initialSnapshot({
        version: 3,
        createdAt: nearRangeEnd,
        lastRotatedAt: nearRangeEnd,
        refreshIdleExpiresAt: '9999-12-30T00:15:00.000001Z',
        refreshAbsoluteExpiresAt: '9999-12-31T00:00:00.000001Z',
      }),
    );
    const account = activeAccount({
      createdAt: '9999-12-29T23:59:59.000001Z',
      updatedAt: '9999-12-29T23:59:59.000001Z',
    });
    const credential = refreshCredential({
      sequence: 2,
      issuedAt: nearRangeEnd,
      expiresAt: '9999-12-30T00:15:00.000001Z',
      consumedAt: nearRangeEnd,
      successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
    });

    const result = sessionFamily.presentRefreshCredential(
      presentationInput(account, credential, { occurredAt: nearRangeEnd }),
    );

    expect(result.kind).toBe('reuse-detected');
    if (result.kind === 'reuse-detected') {
      expect(result.sessionFamily.toSnapshot()).toMatchObject({
        version: 4,
        revokedAt: nearRangeEnd,
        closedReason: 'REFRESH_REUSE_DETECTED',
      });
      expect(result.reusedRefreshCredential).toBe(credential);
    }
  });
});

describe('IdentitySessionFamily rejected refresh presentation', (): void => {
  it.each([
    [
      'already-revoked family',
      (): readonly [IdentitySessionFamily, IdentityAccount, IdentityRefreshCredential, string] => {
        const created = createSessionBundle();
        const revoked = created.sessionFamily.revoke({
          closedReason: 'LOGOUT',
          occurredAt: '2026-08-23T10:05:00.000002Z',
        }).sessionFamily;
        return [
          revoked,
          activeAccount(),
          created.initialRefreshCredential,
          '2026-08-23T10:05:00.000002Z',
        ];
      },
    ],
    [
      'absolute expiry equality',
      (): readonly [IdentitySessionFamily, IdentityAccount, IdentityRefreshCredential, string] => {
        const created = createSessionBundle();
        return [
          created.sessionFamily,
          activeAccount(),
          created.initialRefreshCredential,
          ABSOLUTE_EXPIRES_AT,
        ];
      },
    ],
    [
      'idle and current-credential expiry equality',
      (): readonly [IdentitySessionFamily, IdentityAccount, IdentityRefreshCredential, string] => {
        const created = createSessionBundle();
        return [
          created.sessionFamily,
          activeAccount(),
          created.initialRefreshCredential,
          INITIAL_IDLE_EXPIRES_AT,
        ];
      },
    ],
    [
      'suspended Account with a current credential',
      (): readonly [IdentitySessionFamily, IdentityAccount, IdentityRefreshCredential, string] => {
        const created = createSessionBundle();
        return [
          created.sessionFamily,
          suspendedAccount(),
          created.initialRefreshCredential,
          '2026-08-23T10:05:00.000002Z',
        ];
      },
    ],
    [
      'deactivated Account with a current credential',
      (): readonly [IdentitySessionFamily, IdentityAccount, IdentityRefreshCredential, string] => {
        const created = createSessionBundle();
        return [
          created.sessionFamily,
          deactivatedAccount(),
          created.initialRefreshCredential,
          '2026-08-23T10:05:00.000002Z',
        ];
      },
    ],
    [
      'less than one whole second before absolute expiry',
      (): readonly [IdentitySessionFamily, IdentityAccount, IdentityRefreshCredential, string] => [
        IdentitySessionFamily.rehydrate(cappedRotatedSnapshot()),
        activeAccount(),
        refreshCredential({
          id: SUCCESSOR_REFRESH_CREDENTIAL_ID,
          sequence: 2,
          issuedAt: '2026-08-24T09:59:59.000001Z',
          expiresAt: ABSOLUTE_EXPIRES_AT,
        }),
        '2026-08-24T09:59:59.000002Z',
      ],
    ],
  ] as const)(
    'returns one indistinguishable immutable rejection for %s',
    (_scenario, arrange): void => {
      const [sessionFamily, account, credential, occurredAt] = arrange();
      const familyBefore = sessionFamily.toSnapshot();
      const accountBefore = account.toSnapshot();
      const credentialBefore = credential.toSnapshot();
      const result = sessionFamily.presentRefreshCredential(
        presentationInput(account, credential, {
          occurredAt,
          successorRefreshCredentialId: 'ignored-invalid-successor',
          refreshIdleLifetimeSeconds: 'ignored-invalid-idle',
        }),
      );

      expect(result).toEqual({
        kind: 'rejected',
        sessionFamily,
        presentedRefreshCredential: credential,
        facts: [],
      });
      expect(Object.keys(result).sort()).toEqual(
        ['facts', 'kind', 'presentedRefreshCredential', 'sessionFamily'].sort(),
      );
      expect(Object.hasOwn(result, 'basis')).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
      expectFrozenSafeFacts(result.facts);
      expect(sessionFamily.toSnapshot()).toBe(familyBefore);
      expect(account.toSnapshot()).toBe(accountBefore);
      expect(credential.toSnapshot()).toBe(credentialBefore);
    },
  );

  it('parses and checks authoritative time before terminal rejection', (): void => {
    const created = createSessionBundle();
    const terminal = created.sessionFamily.revoke({
      closedReason: 'LOGOUT',
      occurredAt: '2026-08-23T10:05:00.000002Z',
    }).sessionFamily;
    const account = activeAccount();

    expectSafePresentationError(
      terminal,
      account,
      created.initialRefreshCredential,
      () =>
        terminal.presentRefreshCredential(
          presentationInput(account, created.initialRefreshCredential, {
            occurredAt: 'invalid-time',
          }),
        ),
      InvalidIdentityInstantError,
    );
    expectSafePresentationError(
      terminal,
      account,
      created.initialRefreshCredential,
      () =>
        terminal.presentRefreshCredential(
          presentationInput(account, created.initialRefreshCredential, {
            occurredAt: CREATED_AT,
          }),
        ),
      IdentitySessionFamilyRefreshTimestampRegressionError,
    );
  });

  it('rejects regression against either the Account or family high-water mark', (): void => {
    const created = createSessionBundle();
    const laterAccount = activeAccount({
      version: 3,
      updatedAt: '2026-08-23T10:06:00.000002Z',
    });

    expectSafePresentationError(
      created.sessionFamily,
      laterAccount,
      created.initialRefreshCredential,
      () =>
        created.sessionFamily.presentRefreshCredential(
          presentationInput(laterAccount, created.initialRefreshCredential),
        ),
      IdentitySessionFamilyRefreshTimestampRegressionError,
    );

    const rotatedFamily = IdentitySessionFamily.rehydrate(rotatedSnapshot());
    const current = refreshCredential({
      id: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      sequence: 2,
      issuedAt: ROTATED_AT,
      expiresAt: ROTATED_IDLE_EXPIRES_AT,
    });
    const account = activeAccount();
    expectSafePresentationError(
      rotatedFamily,
      account,
      current,
      () =>
        rotatedFamily.presentRefreshCredential(
          presentationInput(account, current, {
            occurredAt: '2026-08-23T10:29:59.999999Z',
          }),
        ),
      IdentitySessionFamilyRefreshTimestampRegressionError,
    );
  });
});

describe('IdentitySessionFamily successful refresh rotation', (): void => {
  it('returns one exact immutable atomic rotation bundle', (): void => {
    const created = createSessionBundle();
    const account = activeAccount();
    const occurredAt = '2026-08-23T10:05:00.000002Z';
    const familyBefore = created.sessionFamily.toSnapshot();
    const accountBefore = account.toSnapshot();
    const credentialBefore = created.initialRefreshCredential.toSnapshot();
    const result = created.sessionFamily.presentRefreshCredential(
      presentationInput(account, created.initialRefreshCredential, { occurredAt }),
    );

    expect(result.kind).toBe('rotated');
    if (result.kind !== 'rotated') {
      throw new Error('Expected an atomic rotation result');
    }

    expect(Object.keys(result).sort()).toEqual(
      [
        'basis',
        'consumedRefreshCredential',
        'facts',
        'kind',
        'sessionFamily',
        'successorRefreshCredential',
      ].sort(),
    );
    expect(result.basis).toEqual({
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      sessionId: SESSION_ID,
      sessionFamilyVersion: 1,
      presentedRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
      presentedRefreshCredentialSequence: 1,
    });
    expect(result.sessionFamily.toSnapshot()).toEqual({
      ...familyBefore,
      version: 2,
      lastRotatedAt: occurredAt,
      refreshIdleExpiresAt: '2026-08-23T10:20:00.000002Z',
    });
    expect(result.consumedRefreshCredential.toSnapshot()).toEqual({
      ...credentialBefore,
      consumedAt: occurredAt,
      successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
    });
    expect(result.successorRefreshCredential.toSnapshot()).toEqual({
      id: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      sessionId: SESSION_ID,
      sequence: 2,
      issuedAt: occurredAt,
      expiresAt: '2026-08-23T10:20:00.000002Z',
      consumedAt: null,
      successorId: null,
    });
    expect(result.facts).toEqual([
      {
        type: 'SESSION_FAMILY_REFRESH_ROTATED',
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        state: 'AUTHENTICATING',
        version: 2,
        occurredAt,
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.basis)).toBe(true);
    expect(Object.isFrozen(result.sessionFamily)).toBe(true);
    expect(Object.isFrozen(result.consumedRefreshCredential)).toBe(true);
    expect(Object.isFrozen(result.successorRefreshCredential)).toBe(true);
    expect(Object.isFrozen(result.sessionFamily.toSnapshot())).toBe(true);
    expect(Object.isFrozen(result.consumedRefreshCredential.toSnapshot())).toBe(true);
    expect(Object.isFrozen(result.successorRefreshCredential.toSnapshot())).toBe(true);
    expectFrozenSafeFacts(result.facts);
    expect(JSON.stringify(result.facts)).not.toContain(INITIAL_REFRESH_CREDENTIAL_ID);
    expect(JSON.stringify(result.facts)).not.toContain(SUCCESSOR_REFRESH_CREDENTIAL_ID);
    expect(JSON.stringify(result.basis)).not.toContain('system.admin');
    expect(JSON.stringify(result.basis)).not.toContain('ACTIVE');
    expect(JSON.stringify(result.basis)).not.toContain('expiresAt');
    expect(Object.hasOwn(result, 'account')).toBe(false);
    expect(created.sessionFamily.toSnapshot()).toBe(familyBefore);
    expect(created.initialRefreshCredential.toSnapshot()).toBe(credentialBefore);
    expect(account.toSnapshot()).toBe(accountBefore);
  });

  it('caps a maximum configured idle lifetime at the immutable absolute deadline', (): void => {
    const created = createSessionBundle();
    const result = created.sessionFamily.presentRefreshCredential(
      presentationInput(activeAccount(), created.initialRefreshCredential, {
        refreshIdleLifetimeSeconds: MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      }),
    );

    expect(result.kind).toBe('rotated');
    if (result.kind === 'rotated') {
      expect(result.sessionFamily.toSnapshot().refreshIdleExpiresAt).toBe(ABSOLUTE_EXPIRES_AT);
      expect(result.successorRefreshCredential.toSnapshot().expiresAt).toBe(ABSOLUTE_EXPIRES_AT);
    }
  });

  it('allows exactly one whole second and derives a one-second capped successor', (): void => {
    const family = IdentitySessionFamily.rehydrate(cappedRotatedSnapshot());
    const current = refreshCredential({
      id: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      sequence: 2,
      issuedAt: '2026-08-24T09:59:59.000001Z',
      expiresAt: ABSOLUTE_EXPIRES_AT,
    });
    const result = family.presentRefreshCredential(
      presentationInput(activeAccount(), current, {
        occurredAt: '2026-08-24T09:59:59.000001Z',
        successorRefreshCredentialId: SECOND_SUCCESSOR_REFRESH_CREDENTIAL_ID,
        refreshIdleLifetimeSeconds: MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      }),
    );

    expect(result.kind).toBe('rotated');
    if (result.kind === 'rotated') {
      expect(result.sessionFamily.toSnapshot()).toMatchObject({
        version: 3,
        lastRotatedAt: '2026-08-24T09:59:59.000001Z',
        refreshIdleExpiresAt: ABSOLUTE_EXPIRES_AT,
      });
      expect(result.successorRefreshCredential.toSnapshot()).toMatchObject({
        sequence: 3,
        issuedAt: '2026-08-24T09:59:59.000001Z',
        expiresAt: ABSOLUTE_EXPIRES_AT,
      });
    }
  });

  it('uses the valid absolute cap when configured addition would exceed year 9999', (): void => {
    const createdAt = '9999-12-30T23:59:59.000001Z';
    const lastRotatedAt = '9999-12-31T23:59:58.000001Z';
    const absolute = '9999-12-31T23:59:59.000001Z';
    const family = IdentitySessionFamily.rehydrate(
      initialSnapshot({
        version: 2,
        createdAt,
        lastRotatedAt,
        refreshIdleExpiresAt: absolute,
        refreshAbsoluteExpiresAt: absolute,
      }),
    );
    const account = activeAccount({
      createdAt: '9999-12-01T00:00:00.000001Z',
      updatedAt: '9999-12-01T00:00:00.000001Z',
    });
    const current = refreshCredential({
      id: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      sequence: 2,
      issuedAt: lastRotatedAt,
      expiresAt: absolute,
    });
    const result = family.presentRefreshCredential(
      presentationInput(account, current, {
        occurredAt: lastRotatedAt,
        successorRefreshCredentialId: SECOND_SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    );

    expect(result.kind).toBe('rotated');
    if (result.kind === 'rotated') {
      expect(result.sessionFamily.toSnapshot().refreshIdleExpiresAt).toBe(absolute);
      expect(result.successorRefreshCredential.toSnapshot().expiresAt).toBe(absolute);
    }
  });

  it('preserves microseconds through a leap-day successor deadline', (): void => {
    const created = IdentitySessionFamily.create({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      initialRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
      refreshIdleLifetimeSeconds: 3_600,
      refreshAbsoluteLifetimeSeconds: MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
      occurredAt: '2024-02-28T23:45:00.123456Z',
    });
    const account = activeAccount({
      createdAt: '2024-02-28T22:00:00.123456Z',
      updatedAt: '2024-02-28T22:00:00.123456Z',
    });
    const result = created.sessionFamily.presentRefreshCredential(
      presentationInput(account, created.initialRefreshCredential, {
        occurredAt: '2024-02-28T23:50:00.654321Z',
      }),
    );

    expect(result.kind).toBe('rotated');
    if (result.kind === 'rotated') {
      expect(result.successorRefreshCredential.toSnapshot().expiresAt).toBe(
        '2024-02-29T00:05:00.654321Z',
      );
    }
  });

  it('uses stable successor, idle, conflict, then capacity precedence', (): void => {
    const created = createSessionBundle();
    const account = activeAccount();

    expectSafePresentationError(
      created.sessionFamily,
      account,
      created.initialRefreshCredential,
      () =>
        created.sessionFamily.presentRefreshCredential(
          presentationInput(account, created.initialRefreshCredential, {
            successorRefreshCredentialId: 'invalid-successor',
            refreshIdleLifetimeSeconds: 'invalid-idle',
          }),
        ),
      InvalidIdentityRefreshCredentialIdError,
    );
    expectSafePresentationError(
      created.sessionFamily,
      account,
      created.initialRefreshCredential,
      () =>
        created.sessionFamily.presentRefreshCredential(
          presentationInput(account, created.initialRefreshCredential, {
            refreshIdleLifetimeSeconds: 'invalid-idle',
          }),
        ),
      InvalidIdentityRefreshIdleLifetimeSecondsError,
    );
    expectSafePresentationError(
      created.sessionFamily,
      account,
      created.initialRefreshCredential,
      () =>
        created.sessionFamily.presentRefreshCredential(
          presentationInput(account, created.initialRefreshCredential, {
            successorRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
          }),
        ),
      IdentitySessionFamilyRefreshSuccessorConflictError,
    );

    const maximumOpen = IdentitySessionFamily.rehydrate(
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION - 1 }),
    );
    const maximumCurrent = refreshCredential({
      sequence: MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE,
    });
    expectSafePresentationError(
      maximumOpen,
      account,
      maximumCurrent,
      () =>
        maximumOpen.presentRefreshCredential(
          presentationInput(account, maximumCurrent, {
            successorRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
          }),
        ),
      IdentitySessionFamilyRefreshSuccessorConflictError,
    );
    expectSafePresentationError(
      maximumOpen,
      account,
      maximumCurrent,
      () =>
        maximumOpen.presentRefreshCredential(
          presentationInput(account, maximumCurrent, {
            refreshIdleLifetimeSeconds: 'invalid-idle',
          }),
        ),
      InvalidIdentityRefreshIdleLifetimeSecondsError,
    );
    expectSafePresentationError(
      maximumOpen,
      account,
      maximumCurrent,
      () => maximumOpen.presentRefreshCredential(presentationInput(account, maximumCurrent)),
      IdentitySessionFamilyRefreshCapacityExhaustedError,
    );
  });

  it('allows the last rotation that preserves the terminal version reserve', (): void => {
    const family = IdentitySessionFamily.rehydrate(
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION - 2 }),
    );
    const current = refreshCredential({
      sequence: MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE - 1,
    });
    const result = family.presentRefreshCredential(presentationInput(activeAccount(), current));

    expect(result.kind).toBe('rotated');
    if (result.kind === 'rotated') {
      expect(result.sessionFamily.toSnapshot().version).toBe(MAX_IDENTITY_AGGREGATE_VERSION - 1);
      expect(result.consumedRefreshCredential.toSnapshot().sequence).toBe(
        MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE - 1,
      );
      expect(result.successorRefreshCredential.toSnapshot().sequence).toBe(
        MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE,
      );
    }
  });
});

describe('IdentitySessionFamily refresh reuse detection', (): void => {
  it('closes the family atomically from a lost committed rotation response', (): void => {
    const created = createSessionBundle();
    const account = activeAccount();
    const winner = created.sessionFamily.presentRefreshCredential(
      presentationInput(account, created.initialRefreshCredential),
    );
    expect(winner.kind).toBe('rotated');
    if (winner.kind !== 'rotated') {
      throw new Error('Expected the first presentation to rotate');
    }

    const familyBefore = winner.sessionFamily.toSnapshot();
    const reusedBefore = winner.consumedRefreshCredential.toSnapshot();
    const occurredAt = '2026-08-23T10:30:00.000003Z';
    const replay = winner.sessionFamily.presentRefreshCredential(
      presentationInput(account, winner.consumedRefreshCredential, {
        occurredAt,
        successorRefreshCredentialId: 'ignored-invalid-successor',
        refreshIdleLifetimeSeconds: 'ignored-invalid-idle',
      }),
    );

    expect(replay.kind).toBe('reuse-detected');
    if (replay.kind !== 'reuse-detected') {
      throw new Error('Expected replay detection');
    }
    expect(Object.keys(replay).sort()).toEqual(
      ['basis', 'facts', 'kind', 'reusedRefreshCredential', 'sessionFamily'].sort(),
    );
    expect(replay.basis).toEqual({
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      sessionId: SESSION_ID,
      sessionFamilyVersion: 2,
      presentedRefreshCredentialId: INITIAL_REFRESH_CREDENTIAL_ID,
      presentedRefreshCredentialSequence: 1,
    });
    expect(replay.sessionFamily.toSnapshot()).toEqual({
      ...familyBefore,
      version: 3,
      revokedAt: occurredAt,
      closedReason: 'REFRESH_REUSE_DETECTED',
    });
    expect(replay.reusedRefreshCredential).toBe(winner.consumedRefreshCredential);
    expect(replay.reusedRefreshCredential.toSnapshot()).toBe(reusedBefore);
    expect(replay.facts).toEqual([
      {
        type: 'SESSION_FAMILY_REVOKED',
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        state: 'REVOKED',
        version: 3,
        occurredAt,
        closedReason: 'REFRESH_REUSE_DETECTED',
      },
    ]);
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.basis)).toBe(true);
    expect(Object.isFrozen(replay.sessionFamily)).toBe(true);
    expectFrozenSafeFacts(replay.facts);
    expect(JSON.stringify(replay.facts)).not.toContain(INITIAL_REFRESH_CREDENTIAL_ID);
    expect(Object.hasOwn(replay, 'successorRefreshCredential')).toBe(false);
    expect(winner.sessionFamily.toSnapshot()).toBe(familyBefore);
    expect(winner.consumedRefreshCredential.toSnapshot()).toBe(reusedBefore);
  });

  it.each([
    ['Suspended', (): IdentityAccount => suspendedAccount()],
    ['Deactivated', (): IdentityAccount => deactivatedAccount()],
  ] as const)(
    'does not let a %s Account suppress fail-secure replay closure',
    (_status, accountFactory): void => {
      const created = createSessionBundle();
      const winner = created.sessionFamily.presentRefreshCredential(
        presentationInput(activeAccount(), created.initialRefreshCredential),
      );
      expect(winner.kind).toBe('rotated');
      if (winner.kind !== 'rotated') {
        throw new Error('Expected the first presentation to rotate');
      }
      const account = accountFactory();
      const accountBefore = account.toSnapshot();
      const replay = winner.sessionFamily.presentRefreshCredential(
        presentationInput(account, winner.consumedRefreshCredential, {
          occurredAt: '2026-08-23T10:30:00.000003Z',
          successorRefreshCredentialId: 'ignored-invalid-successor',
          refreshIdleLifetimeSeconds: 'ignored-invalid-idle',
        }),
      );

      expect(replay.kind).toBe('reuse-detected');
      if (replay.kind === 'reuse-detected') {
        expect(replay.basis.accountVersion).toBe(accountBefore.version);
        expect(replay.sessionFamily.toSnapshot().closedReason).toBe('REFRESH_REUSE_DETECTED');
      }
      expect(account.toSnapshot()).toBe(accountBefore);
    },
  );

  it('detects an older retained predecessor rather than only the immediate predecessor', (): void => {
    const created = createSessionBundle();
    const account = activeAccount();
    const first = created.sessionFamily.presentRefreshCredential(
      presentationInput(account, created.initialRefreshCredential),
    );
    expect(first.kind).toBe('rotated');
    if (first.kind !== 'rotated') {
      throw new Error('Expected first rotation');
    }
    const second = first.sessionFamily.presentRefreshCredential(
      presentationInput(account, first.successorRefreshCredential, {
        occurredAt: '2026-08-23T10:10:00.000003Z',
        successorRefreshCredentialId: SECOND_SUCCESSOR_REFRESH_CREDENTIAL_ID,
      }),
    );
    expect(second.kind).toBe('rotated');
    if (second.kind !== 'rotated') {
      throw new Error('Expected second rotation');
    }

    const replay = second.sessionFamily.presentRefreshCredential(
      presentationInput(account, first.consumedRefreshCredential, {
        occurredAt: '2026-08-23T10:11:00.000004Z',
      }),
    );

    expect(replay.kind).toBe('reuse-detected');
    if (replay.kind === 'reuse-detected') {
      expect(replay.basis).toMatchObject({
        sessionFamilyVersion: 3,
        presentedRefreshCredentialSequence: 1,
      });
      expect(replay.sessionFamily.toSnapshot()).toMatchObject({
        version: 4,
        closedReason: 'REFRESH_REUSE_DETECTED',
      });
    }
  });

  it('rejects consumed replay at absolute expiry without replacing state', (): void => {
    const created = createSessionBundle();
    const account = activeAccount();
    const winner = created.sessionFamily.presentRefreshCredential(
      presentationInput(account, created.initialRefreshCredential),
    );
    expect(winner.kind).toBe('rotated');
    if (winner.kind !== 'rotated') {
      throw new Error('Expected rotation');
    }

    const replay = winner.sessionFamily.presentRefreshCredential(
      presentationInput(account, winner.consumedRefreshCredential, {
        occurredAt: ABSOLUTE_EXPIRES_AT,
      }),
    );

    expect(replay).toEqual({
      kind: 'rejected',
      sessionFamily: winner.sessionFamily,
      presentedRefreshCredential: winner.consumedRefreshCredential,
      facts: [],
    });
  });

  it('never replaces an existing terminal reason with reuse detection', (): void => {
    const created = createSessionBundle();
    const terminal = created.sessionFamily.revoke({
      closedReason: 'LOGOUT',
      occurredAt: '2026-08-23T10:05:00.000002Z',
    }).sessionFamily;
    const current = created.initialRefreshCredential;
    const result = terminal.presentRefreshCredential(
      presentationInput(activeAccount(), current, {
        occurredAt: '2026-08-23T10:06:00.000003Z',
      }),
    );

    expect(result.kind).toBe('rejected');
    expect(result.sessionFamily.toSnapshot()).toMatchObject({
      version: 2,
      closedReason: 'LOGOUT',
    });
  });

  it('uses the reserved terminal family version for replay closure', (): void => {
    const family = IdentitySessionFamily.rehydrate(
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION - 1 }),
    );
    const reused = refreshCredential({
      consumedAt: CREATED_AT,
      successorId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
    });
    const result = family.presentRefreshCredential(
      presentationInput(activeAccount(), reused, { occurredAt: CREATED_AT }),
    );

    expect(result.kind).toBe('reuse-detected');
    if (result.kind === 'reuse-detected') {
      expect(result.sessionFamily.toSnapshot()).toMatchObject({
        version: MAX_IDENTITY_AGGREGATE_VERSION,
        revokedAt: CREATED_AT,
        closedReason: 'REFRESH_REUSE_DETECTED',
      });
    }
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

  it('uses the reserved final version for terminal revocation', (): void => {
    const maximumOpen = IdentitySessionFamily.rehydrate(
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION - 1 }),
    );
    const result = maximumOpen.revoke({ closedReason: 'LOGOUT', occurredAt: ROTATED_AT });

    expect(result.kind).toBe('changed');
    expect(result.sessionFamily.toSnapshot()).toMatchObject({
      version: MAX_IDENTITY_AGGREGATE_VERSION,
      revokedAt: ROTATED_AT,
      closedReason: 'LOGOUT',
    });
  });

  it('enforces reason then occurrence precedence at the maximum open version', (): void => {
    const maximum = IdentitySessionFamily.rehydrate(
      initialSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION - 1 }),
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
