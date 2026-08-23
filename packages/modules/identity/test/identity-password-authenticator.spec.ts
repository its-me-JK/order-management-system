import { inspect } from 'node:util';

import { InvalidIdentityAccountIdError } from '../src/domain/identity-account.values';
import {
  IdentityPasswordAuthenticatorDeadlineOverflowError,
  IdentityPasswordAuthenticatorLifecycleConflictError,
  IdentityPasswordAuthenticatorSamePhcError,
  IdentityPasswordAuthenticatorTimestampRegressionError,
  IdentityPasswordAuthenticatorVerificationNotPermittedError,
  IdentityPasswordAuthenticatorVerificationSnapshotMismatchError,
  IdentityPasswordAuthenticatorVersionMismatchError,
  InvalidIdentityPasswordAuthenticatorStateError,
} from '../src/domain/identity-password-authenticator.errors';
import {
  IdentityPasswordAuthenticator,
  type CreateIdentityPasswordAuthenticatorInput,
  type IdentityPasswordAuthenticatorSnapshot,
  type IdentityPasswordVerificationBasis,
} from '../src/domain/identity-password-authenticator';
import {
  IDENTITY_PASSWORD_AUTHENTICATOR_STATUSES,
  InvalidIdentityConsecutiveFailureCountError,
  InvalidIdentityPasswordAuthenticatorStatusError,
  MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT,
  parseIdentityConsecutiveFailureCount,
  parseIdentityPasswordAuthenticatorStatus,
} from '../src/domain/identity-password-authenticator.values';
import {
  InvalidIdentityPasswordPhcError,
  parseIdentityPasswordPhc,
  serializeIdentityPasswordPhc,
} from '../src/domain/identity-password-phc';
import {
  IdentityAggregateVersionExhaustedError,
  InvalidIdentityAggregateVersionError,
  InvalidIdentityInstantError,
  MAX_IDENTITY_AGGREGATE_VERSION,
} from '../src/domain/identity-values';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ac';
const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const TAG = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DEFAULT_PHC = `$argon2id$v=19$m=65536,t=3,p=1$${SALT}$${TAG}`;
const UPGRADED_PHC = `$argon2id$v=19$m=131072,t=4,p=2$${SALT}$B${TAG.slice(1)}`;
const REBOUND_PHC = `$argon2id$v=19$m=65536,t=3,p=1$${SALT}$C${TAG.slice(1)}`;
const CREATED_AT = '2024-01-01T00:00:00.000001Z';
const T0 = '2026-08-23T10:00:00.000001Z';
const T1 = '2026-08-23T10:01:00.000002Z';
const T2 = '2026-08-23T10:02:00.000003Z';
const BEFORE_CREATED_AT = '2023-12-31T23:59:59.999999Z';
const MAX_INSTANT = '9999-12-31T23:59:59.999999Z';

type RawPasswordAuthenticatorSnapshot = Readonly<{
  accountId: unknown;
  passwordPhc: unknown;
  status: unknown;
  version: unknown;
  consecutiveFailureCount: unknown;
  nextVerificationAt: unknown;
  disabledAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  passwordChangedAt: unknown;
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

function activeSnapshot(
  overrides: Partial<RawPasswordAuthenticatorSnapshot> = {},
): RawPasswordAuthenticatorSnapshot {
  return {
    accountId: ACCOUNT_ID,
    passwordPhc: DEFAULT_PHC,
    status: 'ACTIVE',
    version: 1,
    consecutiveFailureCount: 0,
    nextVerificationAt: null,
    disabledAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    passwordChangedAt: CREATED_AT,
    ...overrides,
  };
}

function failedSnapshot(
  consecutiveFailureCount: number,
  updatedAt: string,
  nextVerificationAt: string | null,
  overrides: Partial<RawPasswordAuthenticatorSnapshot> = {},
): RawPasswordAuthenticatorSnapshot {
  return activeSnapshot({
    version: consecutiveFailureCount + 1,
    consecutiveFailureCount,
    nextVerificationAt,
    updatedAt,
    ...overrides,
  });
}

function rebindRequiredSnapshot(
  overrides: Partial<RawPasswordAuthenticatorSnapshot> = {},
): RawPasswordAuthenticatorSnapshot {
  return activeSnapshot({
    status: 'REBIND_REQUIRED',
    version: 101,
    consecutiveFailureCount: 100,
    nextVerificationAt: null,
    disabledAt: T0,
    updatedAt: T0,
    ...overrides,
  });
}

function createAuthenticator(): IdentityPasswordAuthenticator {
  return IdentityPasswordAuthenticator.create({
    accountId: ACCOUNT_ID,
    passwordPhc: DEFAULT_PHC,
    occurredAt: CREATED_AT,
  }).authenticator;
}

function rehydrateAuthenticator(
  snapshot: RawPasswordAuthenticatorSnapshot,
): IdentityPasswordAuthenticator {
  return IdentityPasswordAuthenticator.rehydrate(snapshot);
}

function encodedSnapshot(
  authenticator: IdentityPasswordAuthenticator,
): RawPasswordAuthenticatorSnapshot {
  const snapshot = authenticator.toSnapshot();

  return {
    ...snapshot,
    passwordPhc: serializeIdentityPasswordPhc(snapshot.passwordPhc),
  };
}

function verificationBasis(
  authenticator: IdentityPasswordAuthenticator,
): IdentityPasswordVerificationBasis {
  const snapshot = authenticator.toSnapshot();

  return Object.freeze({
    accountId: snapshot.accountId,
    version: snapshot.version,
    passwordPhc: snapshot.passwordPhc,
    nextVerificationAt: snapshot.nextVerificationAt,
  });
}

function realVerificationBasis(
  authenticator: IdentityPasswordAuthenticator,
  observedAt: string,
): IdentityPasswordVerificationBasis {
  const plan = authenticator.prepareVerification({ observedAt });

  if (plan.kind !== 'VERIFY_PRESENTED_PASSWORD') {
    throw new Error('Expected a real password-verification plan');
  }

  return plan.basis;
}

function expectFrozenFacts(facts: readonly object[]): void {
  expect(Object.isFrozen(facts)).toBe(true);

  for (const fact of facts) {
    expect(Object.isFrozen(fact)).toBe(true);
  }

  const serialized = JSON.stringify(facts);
  expect(serialized).not.toContain(DEFAULT_PHC);
  expect(serialized).not.toContain(UPGRADED_PHC);
  expect(serialized).not.toContain(REBOUND_PHC);
  expect(serialized).not.toContain('passwordPhc');
  expect(serialized).not.toContain('consecutiveFailureCount');
  expect(serialized).not.toContain('nextVerificationAt');
  expect(serialized).not.toContain('disabledAt');
}

function expectSafeImmutableRejection(
  authenticator: IdentityPasswordAuthenticator,
  operation: () => unknown,
  expectedClass: ErrorClass,
): Error {
  const before = authenticator.toSnapshot();
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  expect(String(error)).not.toContain(ACCOUNT_ID);
  expect(String(error)).not.toContain(DEFAULT_PHC);
  expect(String(error)).not.toContain(UPGRADED_PHC);
  expect(String(error)).not.toContain(REBOUND_PHC);
  expect(String(error)).not.toContain('invalid-phc');
  expect(JSON.stringify(error)).not.toContain(ACCOUNT_ID);
  expect(JSON.stringify(error)).not.toContain(DEFAULT_PHC);
  expect(JSON.stringify(error)).not.toContain('invalid-phc');
  expect(inspect(error)).not.toContain(DEFAULT_PHC);
  expect(authenticator.toSnapshot()).toBe(before);

  return error;
}

describe('IdentityPasswordAuthenticator creation and rehydration', (): void => {
  it('creates exact initial state and one frozen secret-free fact', (): void => {
    const result = IdentityPasswordAuthenticator.create({
      accountId: ACCOUNT_ID,
      passwordPhc: DEFAULT_PHC,
      occurredAt: CREATED_AT,
    });

    expect(result.kind).toBe('changed');
    expect(encodedSnapshot(result.authenticator)).toEqual(activeSnapshot());
    expect(result.facts).toEqual([
      {
        type: 'PASSWORD_AUTHENTICATOR_CREATED',
        accountId: ACCOUNT_ID,
        status: 'ACTIVE',
        version: 1,
        occurredAt: CREATED_AT,
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.authenticator)).toBe(true);
    expect(Object.isFrozen(result.authenticator.toSnapshot())).toBe(true);
    expectFrozenFacts(result.facts);
  });

  it('does not retain a mutable creation input or expose its PHC through ordinary output', (): void => {
    const input = {
      accountId: ACCOUNT_ID,
      passwordPhc: DEFAULT_PHC,
      occurredAt: CREATED_AT,
    };
    const authenticator = IdentityPasswordAuthenticator.create(input).authenticator;
    input.passwordPhc = UPGRADED_PHC;

    expect(serializeIdentityPasswordPhc(authenticator.toSnapshot().passwordPhc)).toBe(DEFAULT_PHC);
    expect(Object.keys(authenticator)).toEqual([]);
    expect(Reflect.ownKeys(authenticator)).toEqual([]);
    expect(JSON.stringify(authenticator)).toBe('{}');
    expect(JSON.stringify(authenticator.toSnapshot())).not.toContain(DEFAULT_PHC);
    expect(inspect(authenticator, { showHidden: true })).not.toContain(DEFAULT_PHC);
    expect(inspect(authenticator.toSnapshot(), { showHidden: true })).not.toContain(DEFAULT_PHC);
  });

  it.each([
    [
      'missing Account id',
      { accountId: undefined, passwordPhc: DEFAULT_PHC, occurredAt: CREATED_AT },
      InvalidIdentityAccountIdError,
    ],
    [
      'malformed Account id',
      { accountId: 'not-an-account-id', passwordPhc: DEFAULT_PHC, occurredAt: CREATED_AT },
      InvalidIdentityAccountIdError,
    ],
    [
      'missing PHC',
      { accountId: ACCOUNT_ID, passwordPhc: undefined, occurredAt: CREATED_AT },
      InvalidIdentityPasswordPhcError,
    ],
    [
      'malformed PHC',
      { accountId: ACCOUNT_ID, passwordPhc: 'secret-malformed-phc', occurredAt: CREATED_AT },
      InvalidIdentityPasswordPhcError,
    ],
    [
      'missing occurrence time',
      { accountId: ACCOUNT_ID, passwordPhc: DEFAULT_PHC, occurredAt: undefined },
      InvalidIdentityInstantError,
    ],
    [
      'malformed occurrence time',
      { accountId: ACCOUNT_ID, passwordPhc: DEFAULT_PHC, occurredAt: 'not-an-instant' },
      InvalidIdentityInstantError,
    ],
  ] as const)(
    'rejects creation with a %s before returning state or facts',
    (_scenario, input, expectedError): void => {
      let result: ReturnType<typeof IdentityPasswordAuthenticator.create> | null = null;

      expect(() => {
        result = IdentityPasswordAuthenticator.create(
          input satisfies CreateIdentityPasswordAuthenticatorInput,
        );
      }).toThrow(expectedError);
      expect(result).toBeNull();
    },
  );

  it.each([
    ['fresh Active state', activeSnapshot()],
    ['Active after one failure', failedSnapshot(1, T0, null)],
    ['Active after four failures', failedSnapshot(4, T0, null)],
    ['first cooling state', failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z')],
    ['512-second cooling state', failedSnapshot(14, T0, '2026-08-23T10:08:32.000001Z')],
    ['first capped cooling state', failedSnapshot(15, T0, '2026-08-23T10:15:00.000001Z')],
    ['last Active cooling state', failedSnapshot(99, T0, '2026-08-23T10:15:00.000001Z')],
    [
      'clean state after a later successful mutation',
      activeSnapshot({ version: 42, updatedAt: T1 }),
    ],
    ['disabled state', rebindRequiredSnapshot()],
    [
      'state whose mutations share one database instant',
      failedSnapshot(5, CREATED_AT, '2024-01-01T00:00:01.000001Z'),
    ],
  ])('rehydrates a reachable %s without producing facts', (_scenario, rawSnapshot): void => {
    const authenticator = rehydrateAuthenticator(rawSnapshot);

    expect(encodedSnapshot(authenticator)).toEqual(rawSnapshot);
    expect(Object.isFrozen(authenticator)).toBe(true);
    expect(Object.isFrozen(authenticator.toSnapshot())).toBe(true);
    expect(Object.keys(authenticator)).toEqual([]);
  });

  it('does not retain a mutable persistence record', (): void => {
    const rawSnapshot = { ...failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z') };
    const authenticator = rehydrateAuthenticator(rawSnapshot);
    rawSnapshot.passwordPhc = UPGRADED_PHC;
    rawSnapshot.consecutiveFailureCount = 99;

    expect(encodedSnapshot(authenticator)).toEqual(
      failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z'),
    );
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing required member', { accountId: ACCOUNT_ID }],
    ['additional member', { ...activeSnapshot(), internal: 'value' }],
    ['invalid Account id', activeSnapshot({ accountId: 'persistence-account-id' })],
    ['invalid PHC', activeSnapshot({ passwordPhc: 'persistence-secret-phc' })],
    ['invalid status', activeSnapshot({ status: 'DISABLED' })],
    ['invalid version', activeSnapshot({ version: 0 })],
    ['negative count', activeSnapshot({ consecutiveFailureCount: -1 })],
    ['fractional count', activeSnapshot({ consecutiveFailureCount: 1.5 })],
    ['count above 100', activeSnapshot({ consecutiveFailureCount: 101 })],
    ['invalid creation instant', activeSnapshot({ createdAt: 'not-an-instant' })],
    ['update before creation', activeSnapshot({ updatedAt: BEFORE_CREATED_AT })],
    ['password change before creation', activeSnapshot({ passwordChangedAt: BEFORE_CREATED_AT })],
    ['password change after update', activeSnapshot({ passwordChangedAt: T1 })],
    ['version 1 with a later update', activeSnapshot({ updatedAt: T0 })],
    ['version 1 with a later password change', activeSnapshot({ passwordChangedAt: T0 })],
    ['version 1 with a failure', failedSnapshot(1, T0, null, { version: 1 })],
    ['positive count below its minimum version', failedSnapshot(4, T0, null, { version: 4 })],
    ['Active count 100', failedSnapshot(100, T0, null)],
    ['Active state with disabled time', activeSnapshot({ version: 2, disabledAt: T0 })],
    ['low failure count with deadline', failedSnapshot(4, T0, '2026-08-23T10:00:01.000001Z')],
    ['cooling count without deadline', failedSnapshot(5, T0, null)],
    [
      'cooling deadline one microsecond early',
      failedSnapshot(5, T0, '2026-08-23T10:00:01.000000Z'),
    ],
    ['cooling deadline one microsecond late', failedSnapshot(5, T0, '2026-08-23T10:00:01.000002Z')],
    [
      'uncapped deadline at the cap boundary',
      failedSnapshot(15, T0, '2026-08-23T10:17:04.000001Z'),
    ],
    ['disabled state below count 100', rebindRequiredSnapshot({ consecutiveFailureCount: 99 })],
    ['disabled state below minimum version', rebindRequiredSnapshot({ version: 100 })],
    ['disabled state retaining a deadline', rebindRequiredSnapshot({ nextVerificationAt: T1 })],
    ['disabled state without disabled time', rebindRequiredSnapshot({ disabledAt: null })],
    ['disabled state with stale disabled time', rebindRequiredSnapshot({ disabledAt: CREATED_AT })],
    ['cooldown beyond the supported time range', failedSnapshot(5, MAX_INSTANT, MAX_INSTANT)],
  ])(
    'rejects an unreachable %s with one fixed cause-free error',
    (_scenario, rawSnapshot): void => {
      const error = captureError(() => IdentityPasswordAuthenticator.rehydrate(rawSnapshot));

      expect(error).toBeInstanceOf(InvalidIdentityPasswordAuthenticatorStateError);
      expect(error).toMatchObject({
        message: 'Expected a valid Identity Password Authenticator snapshot',
        name: 'InvalidIdentityPasswordAuthenticatorStateError',
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(String(error)).not.toContain('persistence-account-id');
      expect(String(error)).not.toContain('persistence-secret-phc');
      expect(JSON.stringify(error)).not.toContain('persistence-secret-phc');
    },
  );
});

describe('IdentityPasswordAuthenticator verification planning', (): void => {
  it('returns a frozen real plan with the complete redacting verification basis', (): void => {
    const authenticator = createAuthenticator();
    const before = authenticator.toSnapshot();
    const plan = authenticator.prepareVerification({ observedAt: T0 });

    expect(plan.kind).toBe('VERIFY_PRESENTED_PASSWORD');
    if (plan.kind !== 'VERIFY_PRESENTED_PASSWORD') {
      throw new Error('Expected a real plan');
    }

    expect(plan.basis).toEqual({
      accountId: ACCOUNT_ID,
      version: 1,
      passwordPhc: before.passwordPhc,
      nextVerificationAt: null,
    });
    expect(Object.keys(plan.basis)).toEqual([
      'accountId',
      'version',
      'passwordPhc',
      'nextVerificationAt',
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.basis)).toBe(true);
    expect(JSON.stringify(plan)).not.toContain(DEFAULT_PHC);
    expect(inspect(plan, { showHidden: true })).not.toContain(DEFAULT_PHC);
    expect(authenticator.toSnapshot()).toBe(before);
  });

  it('uses the same frozen dummy plan for cooldown and disabled state', (): void => {
    const cooling = rehydrateAuthenticator(failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z'));
    const disabled = rehydrateAuthenticator(rebindRequiredSnapshot());
    const coolingPlan = cooling.prepareVerification({
      observedAt: '2026-08-23T10:00:01.000000Z',
    });
    const disabledPlan = disabled.prepareVerification({ observedAt: T1 });

    expect(coolingPlan).toEqual({ kind: 'VERIFY_DUMMY_PASSWORD' });
    expect(disabledPlan).toEqual({ kind: 'VERIFY_DUMMY_PASSWORD' });
    expect(coolingPlan).toBe(disabledPlan);
    expect(Object.isFrozen(coolingPlan)).toBe(true);
    expect(Object.keys(coolingPlan)).toEqual(['kind']);
  });

  it.each([
    ['one microsecond before', '2026-08-23T10:00:01.000000Z', 'VERIFY_DUMMY_PASSWORD'],
    ['exactly at', '2026-08-23T10:00:01.000001Z', 'VERIFY_PRESENTED_PASSWORD'],
    ['one microsecond after', '2026-08-23T10:00:01.000002Z', 'VERIFY_PRESENTED_PASSWORD'],
  ] as const)(
    'uses the correct plan %s the cooldown deadline',
    (_scenario, observedAt, kind): void => {
      const authenticator = rehydrateAuthenticator(
        failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z'),
      );

      expect(authenticator.prepareVerification({ observedAt }).kind).toBe(kind);
    },
  );

  it.each([
    ['malformed observation', 'not-an-instant', InvalidIdentityInstantError],
    [
      'regressed observation',
      BEFORE_CREATED_AT,
      IdentityPasswordAuthenticatorTimestampRegressionError,
    ],
  ] as const)(
    'rejects a %s without mutating state',
    (_scenario, observedAt, expectedError): void => {
      const authenticator = createAuthenticator();

      expectSafeImmutableRejection(
        authenticator,
        () => authenticator.prepareVerification({ observedAt }),
        expectedError,
      );
    },
  );
});

describe('IdentityPasswordAuthenticator failed verification transitions', (): void => {
  const boundaryCases = [
    {
      priorCount: 0,
      priorUpdatedAt: CREATED_AT,
      priorDeadline: null,
      occurredAt: T0,
      expectedDeadline: null,
    },
    {
      priorCount: 3,
      priorUpdatedAt: T0,
      priorDeadline: null,
      occurredAt: T1,
      expectedDeadline: null,
    },
    {
      priorCount: 4,
      priorUpdatedAt: T0,
      priorDeadline: null,
      occurredAt: '2026-08-23T23:59:59.123456Z',
      expectedDeadline: '2026-08-24T00:00:00.123456Z',
    },
    {
      priorCount: 4,
      priorUpdatedAt: T0,
      priorDeadline: null,
      occurredAt: '2027-04-30T23:59:59.222222Z',
      expectedDeadline: '2027-05-01T00:00:00.222222Z',
    },
    {
      priorCount: 4,
      priorUpdatedAt: T0,
      priorDeadline: null,
      occurredAt: '2099-12-31T23:59:59.000001Z',
      expectedDeadline: '2100-01-01T00:00:00.000001Z',
    },
    {
      priorCount: 4,
      priorUpdatedAt: T0,
      priorDeadline: null,
      occurredAt: '2100-02-28T23:59:59.999999Z',
      expectedDeadline: '2100-03-01T00:00:00.999999Z',
    },
    {
      priorCount: 5,
      priorUpdatedAt: '2026-08-23T23:59:58.123456Z',
      priorDeadline: '2026-08-23T23:59:59.123456Z',
      occurredAt: '2026-08-23T23:59:59.123456Z',
      expectedDeadline: '2026-08-24T00:00:01.123456Z',
    },
    {
      priorCount: 6,
      priorUpdatedAt: '2026-08-23T23:59:57.123456Z',
      priorDeadline: '2026-08-23T23:59:59.123456Z',
      occurredAt: '2026-08-23T23:59:59.123456Z',
      expectedDeadline: '2026-08-24T00:00:03.123456Z',
    },
    {
      priorCount: 13,
      priorUpdatedAt: '2024-02-29T23:45:44.654321Z',
      priorDeadline: '2024-02-29T23:50:00.654321Z',
      occurredAt: '2024-02-29T23:50:00.654321Z',
      expectedDeadline: '2024-02-29T23:58:32.654321Z',
    },
    {
      priorCount: 14,
      priorUpdatedAt: '2024-02-29T23:51:28.654321Z',
      priorDeadline: '2024-03-01T00:00:00.654321Z',
      occurredAt: '2024-03-01T00:00:00.654321Z',
      expectedDeadline: '2024-03-01T00:15:00.654321Z',
    },
    {
      priorCount: 15,
      priorUpdatedAt: '2026-08-23T23:45:00.999999Z',
      priorDeadline: '2026-08-24T00:00:00.999999Z',
      occurredAt: '2026-08-24T00:00:00.999999Z',
      expectedDeadline: '2026-08-24T00:15:00.999999Z',
    },
    {
      priorCount: 98,
      priorUpdatedAt: T0,
      priorDeadline: '2026-08-23T10:15:00.000001Z',
      occurredAt: '2026-08-23T10:15:00.000001Z',
      expectedDeadline: '2026-08-23T10:30:00.000001Z',
    },
    {
      priorCount: 99,
      priorUpdatedAt: T0,
      priorDeadline: '2026-08-23T10:15:00.000001Z',
      occurredAt: '2026-08-23T10:15:00.000001Z',
      expectedDeadline: null,
    },
  ] as const;

  it.each(boundaryCases)(
    'records failure after count $priorCount with exact lossless cooldown state',
    ({ priorCount, priorUpdatedAt, priorDeadline, occurredAt, expectedDeadline }): void => {
      const authenticator =
        priorCount === 0
          ? createAuthenticator()
          : rehydrateAuthenticator(failedSnapshot(priorCount, priorUpdatedAt, priorDeadline));
      const before = authenticator.toSnapshot();
      const basis = realVerificationBasis(authenticator, occurredAt);
      const result = authenticator.recordFailedVerification({ basis, occurredAt });
      const after = result.authenticator.toSnapshot();
      const nextCount = priorCount + 1;
      const resultingStatus = nextCount === 100 ? 'REBIND_REQUIRED' : 'ACTIVE';

      expect(after).toMatchObject({
        accountId: ACCOUNT_ID,
        status: resultingStatus,
        version: before.version + 1,
        consecutiveFailureCount: nextCount,
        nextVerificationAt: expectedDeadline,
        disabledAt: nextCount === 100 ? occurredAt : null,
        createdAt: CREATED_AT,
        updatedAt: occurredAt,
        passwordChangedAt: CREATED_AT,
      });
      expect(serializeIdentityPasswordPhc(after.passwordPhc)).toBe(DEFAULT_PHC);
      expect(result.facts[0]).toEqual({
        type: 'PASSWORD_VERIFICATION_REJECTED',
        accountId: ACCOUNT_ID,
        status: resultingStatus,
        version: before.version + 1,
        occurredAt,
      });
      expect(result.facts).toHaveLength(nextCount === 100 ? 2 : 1);

      if (nextCount === 100) {
        expect(result.facts[1]).toEqual({
          type: 'PASSWORD_AUTHENTICATOR_DISABLED',
          accountId: ACCOUNT_ID,
          status: 'REBIND_REQUIRED',
          version: before.version + 1,
          occurredAt,
        });
      }

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.authenticator)).toBe(true);
      expect(Object.isFrozen(after)).toBe(true);
      expectFrozenFacts(result.facts);
      expect(authenticator.toSnapshot()).toBe(before);
    },
  );

  it('rejects deadline overflow after version capacity has been proved available', (): void => {
    const authenticator = rehydrateAuthenticator(
      failedSnapshot(4, MAX_INSTANT, null, { version: 5 }),
    );
    const basis = realVerificationBasis(authenticator, MAX_INSTANT);

    expectSafeImmutableRejection(
      authenticator,
      () => authenticator.recordFailedVerification({ basis, occurredAt: MAX_INSTANT }),
      IdentityPasswordAuthenticatorDeadlineOverflowError,
    );
  });
});

describe('IdentityPasswordAuthenticator verification-basis races and failure precedence', (): void => {
  it.each([
    ['non-object basis', null],
    ['missing basis member', { accountId: ACCOUNT_ID }],
    [
      'additional basis member',
      {
        ...verificationBasis(createAuthenticator()),
        internal: 'value',
      },
    ],
    [
      'cross-account basis',
      {
        ...verificationBasis(createAuthenticator()),
        accountId: OTHER_ACCOUNT_ID,
      },
    ],
    [
      'stale-version basis',
      {
        ...verificationBasis(createAuthenticator()),
        version: 2,
      },
    ],
    [
      'changed-PHC basis',
      {
        ...verificationBasis(createAuthenticator()),
        passwordPhc: UPGRADED_PHC,
      },
    ],
    [
      'changed-deadline basis',
      {
        ...verificationBasis(createAuthenticator()),
        nextVerificationAt: T1,
      },
    ],
  ])('collapses a %s to the fixed snapshot-mismatch failure', (_scenario, basis): void => {
    const authenticator = createAuthenticator();

    expectSafeImmutableRejection(
      authenticator,
      () => authenticator.recordFailedVerification({ basis, occurredAt: 'not-an-instant' }),
      IdentityPasswordAuthenticatorVerificationSnapshotMismatchError,
    );
  });

  it('rejects a basis prepared before a concurrent failure mutation', (): void => {
    const original = createAuthenticator();
    const oldBasis = realVerificationBasis(original, T0);
    const changed = original.recordFailedVerification({ basis: oldBasis, occurredAt: T0 });

    expectSafeImmutableRejection(
      changed.authenticator,
      () =>
        changed.authenticator.recordSuccessfulVerification({
          basis: oldBasis,
          occurredAt: T1,
          upgradedPasswordPhc: null,
        }),
      IdentityPasswordAuthenticatorVerificationSnapshotMismatchError,
    );
  });

  it('rejects a basis when PHC or deadline changed without relying only on version', (): void => {
    const original = rehydrateAuthenticator(failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z'));
    const oldBasis = realVerificationBasis(original, '2026-08-23T10:00:01.000001Z');
    const changedPhc = rehydrateAuthenticator(
      failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z', {
        passwordPhc: UPGRADED_PHC,
      }),
    );
    const changedDeadline = rehydrateAuthenticator(
      failedSnapshot(5, T1, '2026-08-23T10:01:01.000002Z'),
    );

    for (const authenticator of [changedPhc, changedDeadline]) {
      expectSafeImmutableRejection(
        authenticator,
        () => authenticator.recordFailedVerification({ basis: oldBasis, occurredAt: T2 }),
        IdentityPasswordAuthenticatorVerificationSnapshotMismatchError,
      );
    }
  });

  it('enforces basis, lifecycle, occurrence, cooldown, version, then deadline precedence', (): void => {
    const disabled = rehydrateAuthenticator(rebindRequiredSnapshot());
    const disabledBasis = verificationBasis(disabled);
    const cooling = rehydrateAuthenticator(failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z'));
    const coolingBasis = verificationBasis(cooling);
    const maximumVersion = rehydrateAuthenticator(
      activeSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION, updatedAt: T0 }),
    );
    const maximumBasis = realVerificationBasis(maximumVersion, T1);
    const maximumDeadline = rehydrateAuthenticator(
      failedSnapshot(4, MAX_INSTANT, null, { version: MAX_IDENTITY_AGGREGATE_VERSION }),
    );
    const maximumDeadlineBasis = realVerificationBasis(maximumDeadline, MAX_INSTANT);
    const active = createAuthenticator();
    const activeBasis = verificationBasis(active);

    expectSafeImmutableRejection(
      disabled,
      () =>
        disabled.recordFailedVerification({
          basis: { ...disabledBasis, version: 102 },
          occurredAt: 'not-an-instant',
        }),
      IdentityPasswordAuthenticatorVerificationSnapshotMismatchError,
    );
    expectSafeImmutableRejection(
      disabled,
      () =>
        disabled.recordFailedVerification({ basis: disabledBasis, occurredAt: 'not-an-instant' }),
      IdentityPasswordAuthenticatorVerificationNotPermittedError,
    );
    expectSafeImmutableRejection(
      active,
      () =>
        active.recordFailedVerification({
          basis: activeBasis,
          occurredAt: 'not-an-instant',
        }),
      InvalidIdentityInstantError,
    );
    expectSafeImmutableRejection(
      cooling,
      () =>
        cooling.recordFailedVerification({ basis: coolingBasis, occurredAt: BEFORE_CREATED_AT }),
      IdentityPasswordAuthenticatorTimestampRegressionError,
    );
    expectSafeImmutableRejection(
      cooling,
      () => cooling.recordFailedVerification({ basis: coolingBasis, occurredAt: T0 }),
      IdentityPasswordAuthenticatorVerificationNotPermittedError,
    );
    expectSafeImmutableRejection(
      maximumVersion,
      () => maximumVersion.recordFailedVerification({ basis: maximumBasis, occurredAt: T1 }),
      IdentityAggregateVersionExhaustedError,
    );
    expectSafeImmutableRejection(
      maximumDeadline,
      () =>
        maximumDeadline.recordFailedVerification({
          basis: maximumDeadlineBasis,
          occurredAt: MAX_INSTANT,
        }),
      IdentityAggregateVersionExhaustedError,
    );
  });
});

describe('IdentityPasswordAuthenticator successful verification transitions', (): void => {
  it('resets failures and the cooldown without changing passwordChangedAt', (): void => {
    const authenticator = rehydrateAuthenticator(
      failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z'),
    );
    const basis = realVerificationBasis(authenticator, '2026-08-23T10:00:01.000001Z');
    const result = authenticator.recordSuccessfulVerification({
      basis,
      occurredAt: '2026-08-23T10:00:01.000001Z',
      upgradedPasswordPhc: null,
    });

    expect(result.kind).toBe('changed');
    expect(encodedSnapshot(result.authenticator)).toEqual(
      activeSnapshot({
        version: 7,
        updatedAt: '2026-08-23T10:00:01.000001Z',
      }),
    );
    expect(result.facts).toEqual([
      {
        type: 'PASSWORD_AUTHENTICATOR_FAILURES_RESET',
        accountId: ACCOUNT_ID,
        status: 'ACTIVE',
        version: 7,
        occurredAt: '2026-08-23T10:00:01.000001Z',
      },
    ]);
    expectFrozenFacts(result.facts);
  });

  it('installs a byte-different upgraded verifier without changing passwordChangedAt', (): void => {
    const authenticator = createAuthenticator();
    const basis = realVerificationBasis(authenticator, T0);
    const result = authenticator.recordSuccessfulVerification({
      basis,
      occurredAt: T0,
      upgradedPasswordPhc: UPGRADED_PHC,
    });

    expect(result.kind).toBe('changed');
    expect(encodedSnapshot(result.authenticator)).toEqual(
      activeSnapshot({ passwordPhc: UPGRADED_PHC, version: 2, updatedAt: T0 }),
    );
    expect(result.facts).toEqual([
      {
        type: 'PASSWORD_AUTHENTICATOR_VERIFIER_UPGRADED',
        accountId: ACCOUNT_ID,
        status: 'ACTIVE',
        version: 2,
        occurredAt: T0,
      },
    ]);
    expectFrozenFacts(result.facts);
  });

  it('resets failures and upgrades the verifier in one version with exact fact order', (): void => {
    const authenticator = rehydrateAuthenticator(failedSnapshot(4, T0, null));
    const basis = realVerificationBasis(authenticator, T1);
    const result = authenticator.recordSuccessfulVerification({
      basis,
      occurredAt: T1,
      upgradedPasswordPhc: UPGRADED_PHC,
    });

    expect(result.kind).toBe('changed');
    expect(encodedSnapshot(result.authenticator)).toEqual(
      activeSnapshot({ passwordPhc: UPGRADED_PHC, version: 6, updatedAt: T1 }),
    );
    expect(result.facts).toEqual([
      {
        type: 'PASSWORD_AUTHENTICATOR_FAILURES_RESET',
        accountId: ACCOUNT_ID,
        status: 'ACTIVE',
        version: 6,
        occurredAt: T1,
      },
      {
        type: 'PASSWORD_AUTHENTICATOR_VERIFIER_UPGRADED',
        accountId: ACCOUNT_ID,
        status: 'ACTIVE',
        version: 6,
        occurredAt: T1,
      },
    ]);
    expectFrozenFacts(result.facts);
  });

  it.each([
    ['no proposed upgrade', null],
    ['same encoded PHC string', DEFAULT_PHC],
    ['same opaque PHC value', parseIdentityPasswordPhc(DEFAULT_PHC)],
  ])('returns the original clean aggregate unchanged for %s', (_scenario, proposedPhc): void => {
    const authenticator = createAuthenticator();
    const basis = realVerificationBasis(authenticator, T0);
    const result = authenticator.recordSuccessfulVerification({
      basis,
      occurredAt: T0,
      upgradedPasswordPhc: proposedPhc,
    });

    expect(result).toEqual({ kind: 'unchanged', authenticator, facts: [] });
    expect(result.authenticator).toBe(authenticator);
    expect(result.authenticator.toSnapshot()).toBe(authenticator.toSnapshot());
    expect(Object.isFrozen(result)).toBe(true);
    expectFrozenFacts(result.facts);
  });

  it('allows a genuine no-op at maximum version without consuming capacity', (): void => {
    const authenticator = rehydrateAuthenticator(
      activeSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION, updatedAt: T0 }),
    );
    const basis = realVerificationBasis(authenticator, T1);
    const result = authenticator.recordSuccessfulVerification({
      basis,
      occurredAt: T1,
      upgradedPasswordPhc: DEFAULT_PHC,
    });

    expect(result.kind).toBe('unchanged');
    expect(result.authenticator).toBe(authenticator);
  });

  it('applies basis, lifecycle, occurrence, cooldown, PHC, then version precedence', (): void => {
    const disabled = rehydrateAuthenticator(rebindRequiredSnapshot());
    const disabledBasis = verificationBasis(disabled);
    const cooling = rehydrateAuthenticator(failedSnapshot(5, T0, '2026-08-23T10:00:01.000001Z'));
    const coolingBasis = verificationBasis(cooling);
    const maximumVersion = rehydrateAuthenticator(
      activeSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION, updatedAt: T0 }),
    );
    const maximumBasis = realVerificationBasis(maximumVersion, T1);
    const maximumWithFailures = rehydrateAuthenticator(
      failedSnapshot(4, T0, null, { version: MAX_IDENTITY_AGGREGATE_VERSION }),
    );
    const maximumWithFailuresBasis = realVerificationBasis(maximumWithFailures, T1);

    expectSafeImmutableRejection(
      disabled,
      () =>
        disabled.recordSuccessfulVerification({
          basis: { ...disabledBasis, version: 102 },
          occurredAt: 'not-an-instant',
          upgradedPasswordPhc: 'invalid-phc',
        }),
      IdentityPasswordAuthenticatorVerificationSnapshotMismatchError,
    );
    expectSafeImmutableRejection(
      disabled,
      () =>
        disabled.recordSuccessfulVerification({
          basis: disabledBasis,
          occurredAt: 'not-an-instant',
          upgradedPasswordPhc: 'invalid-phc',
        }),
      IdentityPasswordAuthenticatorVerificationNotPermittedError,
    );
    expectSafeImmutableRejection(
      cooling,
      () =>
        cooling.recordSuccessfulVerification({
          basis: coolingBasis,
          occurredAt: BEFORE_CREATED_AT,
          upgradedPasswordPhc: 'invalid-phc',
        }),
      IdentityPasswordAuthenticatorTimestampRegressionError,
    );
    expectSafeImmutableRejection(
      cooling,
      () =>
        cooling.recordSuccessfulVerification({
          basis: coolingBasis,
          occurredAt: T0,
          upgradedPasswordPhc: 'invalid-phc',
        }),
      IdentityPasswordAuthenticatorVerificationNotPermittedError,
    );
    expectSafeImmutableRejection(
      maximumVersion,
      () =>
        maximumVersion.recordSuccessfulVerification({
          basis: maximumBasis,
          occurredAt: T1,
          upgradedPasswordPhc: 'invalid-phc',
        }),
      InvalidIdentityPasswordPhcError,
    );
    expectSafeImmutableRejection(
      maximumVersion,
      () =>
        maximumVersion.recordSuccessfulVerification({
          basis: maximumBasis,
          occurredAt: T1,
          upgradedPasswordPhc: UPGRADED_PHC,
        }),
      IdentityAggregateVersionExhaustedError,
    );
    expectSafeImmutableRejection(
      maximumWithFailures,
      () =>
        maximumWithFailures.recordSuccessfulVerification({
          basis: maximumWithFailuresBasis,
          occurredAt: T1,
          upgradedPasswordPhc: null,
        }),
      IdentityAggregateVersionExhaustedError,
    );
  });
});

describe('IdentityPasswordAuthenticator rebind', (): void => {
  it('rebinds disabled state with a byte-different PHC and one exact fact', (): void => {
    const authenticator = rehydrateAuthenticator(rebindRequiredSnapshot());
    const before = authenticator.toSnapshot();
    const result = authenticator.rebind({
      expectedVersion: 101,
      newPasswordPhc: REBOUND_PHC,
      occurredAt: T1,
    });

    expect(encodedSnapshot(result.authenticator)).toEqual(
      activeSnapshot({
        passwordPhc: REBOUND_PHC,
        version: 102,
        updatedAt: T1,
        passwordChangedAt: T1,
      }),
    );
    expect(result.facts).toEqual([
      {
        type: 'PASSWORD_AUTHENTICATOR_REBOUND',
        accountId: ACCOUNT_ID,
        status: 'ACTIVE',
        version: 102,
        occurredAt: T1,
      },
    ]);
    expectFrozenFacts(result.facts);
    expect(authenticator.toSnapshot()).toBe(before);
    expect(result.authenticator.prepareVerification({ observedAt: T1 }).kind).toBe(
      'VERIFY_PRESENTED_PASSWORD',
    );
  });

  it('accepts the same authoritative instant because version orders mutations', (): void => {
    const authenticator = rehydrateAuthenticator(rebindRequiredSnapshot());
    const result = authenticator.rebind({
      expectedVersion: 101,
      newPasswordPhc: REBOUND_PHC,
      occurredAt: T0,
    });

    expect(result.authenticator.toSnapshot()).toMatchObject({
      version: 102,
      status: 'ACTIVE',
      updatedAt: T0,
      passwordChangedAt: T0,
    });
  });

  it('enforces expected version, lifecycle, time, PHC difference, then capacity', (): void => {
    const active = createAuthenticator();
    const disabled = rehydrateAuthenticator(rebindRequiredSnapshot());
    const maximum = rehydrateAuthenticator(
      rebindRequiredSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION }),
    );

    expectSafeImmutableRejection(
      active,
      () =>
        active.rebind({
          expectedVersion: 2,
          newPasswordPhc: 'invalid-phc',
          occurredAt: 'not-an-instant',
        }),
      IdentityPasswordAuthenticatorVersionMismatchError,
    );
    expectSafeImmutableRejection(
      active,
      () =>
        active.rebind({
          expectedVersion: 1,
          newPasswordPhc: 'invalid-phc',
          occurredAt: 'not-an-instant',
        }),
      IdentityPasswordAuthenticatorLifecycleConflictError,
    );
    expectSafeImmutableRejection(
      disabled,
      () =>
        disabled.rebind({
          expectedVersion: 101,
          newPasswordPhc: 'invalid-phc',
          occurredAt: 'not-an-instant',
        }),
      InvalidIdentityInstantError,
    );
    expectSafeImmutableRejection(
      disabled,
      () =>
        disabled.rebind({
          expectedVersion: 101,
          newPasswordPhc: 'invalid-phc',
          occurredAt: BEFORE_CREATED_AT,
        }),
      IdentityPasswordAuthenticatorTimestampRegressionError,
    );
    expectSafeImmutableRejection(
      disabled,
      () =>
        disabled.rebind({
          expectedVersion: 101,
          newPasswordPhc: 'invalid-phc',
          occurredAt: T1,
        }),
      InvalidIdentityPasswordPhcError,
    );
    expectSafeImmutableRejection(
      maximum,
      () =>
        maximum.rebind({
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          newPasswordPhc: DEFAULT_PHC,
          occurredAt: T1,
        }),
      IdentityPasswordAuthenticatorSamePhcError,
    );
    expectSafeImmutableRejection(
      maximum,
      () =>
        maximum.rebind({
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          newPasswordPhc: REBOUND_PHC,
          occurredAt: T1,
        }),
      IdentityAggregateVersionExhaustedError,
    );
  });

  it('distinguishes an invalid version category from a stale valid version', (): void => {
    const authenticator = rehydrateAuthenticator(rebindRequiredSnapshot());

    expectSafeImmutableRejection(
      authenticator,
      () =>
        authenticator.rebind({
          expectedVersion: 0,
          newPasswordPhc: REBOUND_PHC,
          occurredAt: T1,
        }),
      InvalidIdentityAggregateVersionError,
    );
    expectSafeImmutableRejection(
      authenticator,
      () =>
        authenticator.rebind({
          expectedVersion: 100,
          newPasswordPhc: REBOUND_PHC,
          occurredAt: T1,
        }),
      IdentityPasswordAuthenticatorVersionMismatchError,
    );
  });
});

describe('IdentityPasswordAuthenticator values and fixed safe errors', (): void => {
  it.each(IDENTITY_PASSWORD_AUTHENTICATOR_STATUSES)(
    'retains supported authenticator status %s',
    (status): void => {
      expect(parseIdentityPasswordAuthenticatorStatus(status)).toBe(status);
    },
  );

  it.each(['active', 'DISABLED', ' ACTIVE', 'ACTIVE ', '', null, 7])(
    'rejects unsupported authenticator status %p',
    (status): void => {
      expect(() => parseIdentityPasswordAuthenticatorStatus(status)).toThrow(
        InvalidIdentityPasswordAuthenticatorStatusError,
      );
    },
  );

  it.each([0, 1, 99, MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT])(
    'retains supported failure count %d',
    (count): void => {
      expect(parseIdentityConsecutiveFailureCount(count)).toBe(count);
    },
  );

  it.each([-1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY, '1', null])(
    'rejects unsupported failure count %p',
    (count): void => {
      expect(() => parseIdentityConsecutiveFailureCount(count)).toThrow(
        InvalidIdentityConsecutiveFailureCountError,
      );
    },
  );

  it('publishes frozen statuses and fixed cause-free value errors', (): void => {
    const statusError = captureError(() =>
      parseIdentityPasswordAuthenticatorStatus('secret-status'),
    );
    const countError = captureError(() => parseIdentityConsecutiveFailureCount('secret-count'));

    expect(Object.isFrozen(IDENTITY_PASSWORD_AUTHENTICATOR_STATUSES)).toBe(true);
    expect(statusError).toBeInstanceOf(InvalidIdentityPasswordAuthenticatorStatusError);
    expect(countError).toBeInstanceOf(InvalidIdentityConsecutiveFailureCountError);
    expect(String(statusError)).not.toContain('secret-status');
    expect(String(countError)).not.toContain('secret-count');
    expect((statusError as Error & { cause?: unknown }).cause).toBeUndefined();
    expect((countError as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

// The snapshot is intentionally persistence-facing but remains immutable and redacting.
const _snapshotTypeCheck: IdentityPasswordAuthenticatorSnapshot =
  createAuthenticator().toSnapshot();
void _snapshotTypeCheck;
