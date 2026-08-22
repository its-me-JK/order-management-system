import {
  IdentityAccountLifecycleConflictError,
  IdentityAccountTimestampRegressionError,
  IdentityAccountVersionMismatchError,
  InvalidIdentityAccountStateError,
} from '../src/domain/identity-account.errors';
import type { IdentityAccountDomainFact } from '../src/domain/identity-account.facts';
import {
  IdentityAccount,
  type CreateIdentityAccountInput,
  type IdentityAccountChangedResult,
  type IdentityAccountSnapshot,
} from '../src/domain/identity-account';
import {
  InvalidIdentityAccountIdError,
  InvalidIdentityLoginNameError,
  type IdentityAccountStatus,
} from '../src/domain/identity-account.values';
import {
  IdentityAggregateVersionExhaustedError,
  InvalidIdentityAggregateVersionError,
  InvalidIdentityInstantError,
  MAX_IDENTITY_AGGREGATE_VERSION,
} from '../src/domain/identity-values';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const LOGIN_NAME = 'system.admin';
const T0 = '2026-08-23T10:00:00.000001Z';
const T1 = '2026-08-23T10:01:00.000002Z';
const T2 = '2026-08-23T10:02:00.000003Z';
const BEFORE_T0 = '2026-08-23T09:59:59.999999Z';

type RawAccountSnapshot = Readonly<{
  id: unknown;
  loginName: unknown;
  status: unknown;
  version: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  suspendedAt: unknown;
  deactivatedAt: unknown;
}>;

type LifecycleAction = 'suspend' | 'resume' | 'deactivate';
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

function activeSnapshot(overrides: Partial<RawAccountSnapshot> = {}): RawAccountSnapshot {
  return {
    id: ACCOUNT_ID,
    loginName: LOGIN_NAME,
    status: 'ACTIVE',
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    suspendedAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

function suspendedSnapshot(overrides: Partial<RawAccountSnapshot> = {}): RawAccountSnapshot {
  return activeSnapshot({
    status: 'SUSPENDED',
    version: 2,
    updatedAt: T1,
    suspendedAt: T1,
    ...overrides,
  });
}

function resumedSnapshot(overrides: Partial<RawAccountSnapshot> = {}): RawAccountSnapshot {
  return activeSnapshot({
    version: 3,
    updatedAt: T2,
    ...overrides,
  });
}

function deactivatedSnapshot(overrides: Partial<RawAccountSnapshot> = {}): RawAccountSnapshot {
  return activeSnapshot({
    status: 'DEACTIVATED',
    version: 2,
    updatedAt: T1,
    deactivatedAt: T1,
    ...overrides,
  });
}

function createAccount(): IdentityAccount {
  return IdentityAccount.create({
    id: ACCOUNT_ID,
    loginName: LOGIN_NAME,
    occurredAt: T0,
  }).account;
}

function accountInStatus(status: IdentityAccountStatus): IdentityAccount {
  const active = createAccount();

  switch (status) {
    case 'ACTIVE':
      return active;
    case 'SUSPENDED':
      return active.suspend({ expectedVersion: 1, occurredAt: T1 }).account;
    case 'DEACTIVATED':
      return active.deactivate({ expectedVersion: 1, occurredAt: T1 }).account;
  }
}

function performLifecycle(
  account: IdentityAccount,
  action: LifecycleAction,
  occurredAt: unknown = T2,
  expectedVersion: unknown = account.toSnapshot().version,
): IdentityAccountChangedResult {
  switch (action) {
    case 'suspend':
      return account.suspend({ expectedVersion, occurredAt });
    case 'resume':
      return account.resume({ expectedVersion, occurredAt });
    case 'deactivate':
      return account.deactivate({ expectedVersion, occurredAt });
  }
}

function expectedLifecycleFact(
  action: LifecycleAction,
  before: IdentityAccountSnapshot,
  after: IdentityAccountSnapshot,
): IdentityAccountDomainFact {
  const common = {
    accountId: after.id,
    version: after.version,
    occurredAt: after.updatedAt,
  };

  switch (action) {
    case 'suspend':
      return {
        ...common,
        type: 'ACCOUNT_SUSPENDED',
        previousStatus: 'ACTIVE',
        status: 'SUSPENDED',
      };
    case 'resume':
      return {
        ...common,
        type: 'ACCOUNT_RESUMED',
        previousStatus: 'SUSPENDED',
        status: 'ACTIVE',
      };
    case 'deactivate':
      return {
        ...common,
        type: 'ACCOUNT_DEACTIVATED',
        previousStatus: before.status as Exclude<IdentityAccountStatus, 'DEACTIVATED'>,
        status: 'DEACTIVATED',
      };
  }
}

describe('IdentityAccount creation and rehydration', (): void => {
  it('creates the exact initial Active state and one PII-free fact', (): void => {
    const result = IdentityAccount.create({
      id: ACCOUNT_ID,
      loginName: LOGIN_NAME,
      occurredAt: T0,
    });

    expect(result).toEqual({
      kind: 'changed',
      account: result.account,
      fact: {
        type: 'ACCOUNT_CREATED',
        accountId: ACCOUNT_ID,
        status: 'ACTIVE',
        version: 1,
        occurredAt: T0,
      },
    });
    expect(result.account.toSnapshot()).toEqual(activeSnapshot());
    expect(JSON.stringify(result.fact)).not.toContain(LOGIN_NAME);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.account)).toBe(true);
    expect(Object.isFrozen(result.fact)).toBe(true);
    expect(Object.isFrozen(result.account.toSnapshot())).toBe(true);
  });

  it('copies caller values into immutable state without retaining its object', (): void => {
    const input = { id: ACCOUNT_ID, loginName: LOGIN_NAME, occurredAt: T0 };
    const account = IdentityAccount.create(input).account;
    input.loginName = 'changed.outside';

    expect(account.toSnapshot().loginName).toBe(LOGIN_NAME);
    expect(() => {
      (account.toSnapshot() as { loginName: string | null }).loginName = 'runtime.change';
    }).toThrow(TypeError);
    expect(account.toSnapshot().loginName).toBe(LOGIN_NAME);
  });

  it.each([
    [
      'missing identifier',
      { id: undefined, loginName: LOGIN_NAME, occurredAt: T0 },
      InvalidIdentityAccountIdError,
    ],
    [
      'malformed identifier',
      { id: 'not-an-account-id', loginName: LOGIN_NAME, occurredAt: T0 },
      InvalidIdentityAccountIdError,
    ],
    [
      'missing login',
      { id: ACCOUNT_ID, loginName: undefined, occurredAt: T0 },
      InvalidIdentityLoginNameError,
    ],
    [
      'noncanonical login',
      { id: ACCOUNT_ID, loginName: 'System.Admin', occurredAt: T0 },
      InvalidIdentityLoginNameError,
    ],
    [
      'missing occurrence time',
      { id: ACCOUNT_ID, loginName: LOGIN_NAME, occurredAt: undefined },
      InvalidIdentityInstantError,
    ],
    [
      'malformed occurrence time',
      { id: ACCOUNT_ID, loginName: LOGIN_NAME, occurredAt: 'not-an-instant' },
      InvalidIdentityInstantError,
    ],
  ] as const)(
    'rejects factory input with a %s before returning state or a fact',
    (_scenario, input, expectedError): void => {
      let result: ReturnType<typeof IdentityAccount.create> | null = null;

      expect(() => {
        result = IdentityAccount.create(input satisfies CreateIdentityAccountInput);
      }).toThrow(expectedError);
      expect(result).toBeNull();
    },
  );

  it.each([
    ['initial Active account', activeSnapshot()],
    ['resumed Active account', resumedSnapshot()],
    ['Suspended account', suspendedSnapshot()],
    ['Deactivated account retaining its login', deactivatedSnapshot()],
    [
      'Deactivated retention tombstone',
      deactivatedSnapshot({ loginName: null, version: 3, updatedAt: T2 }),
    ],
    [
      'account deactivated after suspension',
      deactivatedSnapshot({ version: 3, updatedAt: T2, deactivatedAt: T2 }),
    ],
  ])('rehydrates a valid %s without creating a fact', (_scenario, snapshot): void => {
    const account = IdentityAccount.rehydrate(snapshot);

    expect(account.toSnapshot()).toEqual(snapshot);
    expect(Object.isFrozen(account)).toBe(true);
    expect(Object.isFrozen(account.toSnapshot())).toBe(true);
    expect(Object.keys(account)).toEqual([]);
  });

  it('does not retain a mutable rehydration object', (): void => {
    const snapshot = { ...suspendedSnapshot() };
    const account = IdentityAccount.rehydrate(snapshot);
    snapshot.loginName = 'changed.persistence';

    expect(account.toSnapshot().loginName).toBe(LOGIN_NAME);
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing required member', { id: ACCOUNT_ID }],
    ['additional member', { ...activeSnapshot(), internal: 'value' }],
    ['invalid id', activeSnapshot({ id: 'persistence-account-id' })],
    ['invalid login', activeSnapshot({ loginName: 'System.Admin' })],
    ['invalid status', activeSnapshot({ status: 'RETIRED' })],
    ['invalid version', activeSnapshot({ version: 0 })],
    ['invalid creation instant', activeSnapshot({ createdAt: 'not-an-instant' })],
    ['updated before creation', activeSnapshot({ updatedAt: BEFORE_T0 })],
    ['suspension before creation', suspendedSnapshot({ suspendedAt: BEFORE_T0 })],
    ['suspension after update', suspendedSnapshot({ suspendedAt: T2 })],
    ['deactivation before creation', deactivatedSnapshot({ deactivatedAt: BEFORE_T0 })],
    ['deactivation after update', deactivatedSnapshot({ deactivatedAt: T2 })],
    ['Active account without login', activeSnapshot({ loginName: null })],
    ['initial Active account with a later update', activeSnapshot({ updatedAt: T1 })],
    ['Active account at unreachable version 2', activeSnapshot({ version: 2 })],
    ['Active account at unreachable even version', resumedSnapshot({ version: 4 })],
    ['Active account with suspension time', resumedSnapshot({ suspendedAt: T1 })],
    ['Active account with deactivation time', resumedSnapshot({ deactivatedAt: T1 })],
    ['Suspended account without login', suspendedSnapshot({ loginName: null })],
    ['Suspended account at unreachable version 1', suspendedSnapshot({ version: 1 })],
    ['Suspended account at unreachable odd version', suspendedSnapshot({ version: 3 })],
    [
      'Suspended account at unreachable maximum odd version',
      suspendedSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION }),
    ],
    ['Suspended account without suspension time', suspendedSnapshot({ suspendedAt: null })],
    ['Suspended account with stale suspension time', suspendedSnapshot({ suspendedAt: T0 })],
    ['Suspended account with deactivation time', suspendedSnapshot({ deactivatedAt: T1 })],
    ['Deactivated account at unreachable version 1', deactivatedSnapshot({ version: 1 })],
    ['Deactivated tombstone without an erasure version', deactivatedSnapshot({ loginName: null })],
    ['Deactivated account without terminal time', deactivatedSnapshot({ deactivatedAt: null })],
    ['Deactivated account with stale terminal time', deactivatedSnapshot({ deactivatedAt: T0 })],
    ['Deactivated account retaining suspension time', deactivatedSnapshot({ suspendedAt: T1 })],
  ])('rejects a corrupt %s with one fixed cause-free error', (_scenario, snapshot): void => {
    let error: unknown;

    try {
      IdentityAccount.rehydrate(snapshot);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidIdentityAccountStateError);
    expect(error).toMatchObject({
      message: 'Expected a valid Identity Account snapshot',
      name: 'InvalidIdentityAccountStateError',
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('persistence-account-id');
    expect(JSON.stringify(error)).not.toContain('System.Admin');
  });
});

describe('IdentityAccount lifecycle', (): void => {
  it.each([
    ['ACTIVE', 'suspend', 'SUSPENDED'],
    ['SUSPENDED', 'resume', 'ACTIVE'],
    ['ACTIVE', 'deactivate', 'DEACTIVATED'],
    ['SUSPENDED', 'deactivate', 'DEACTIVATED'],
  ] as const)(
    'allows %s to %s and returns one immutable PII-free fact',
    (initialStatus, action, resultingStatus): void => {
      const before = accountInStatus(initialStatus);
      const beforeSnapshot = before.toSnapshot();
      const result = performLifecycle(before, action);
      const after = result.account.toSnapshot();

      expect(after.status).toBe(resultingStatus);
      expect(after.version).toBe(beforeSnapshot.version + 1);
      expect(after.updatedAt).toBe(T2);
      expect(result.fact).toEqual(expectedLifecycleFact(action, beforeSnapshot, after));
      expect(JSON.stringify(result.fact)).not.toContain(LOGIN_NAME);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.fact)).toBe(true);
      expect(Object.isFrozen(result.account)).toBe(true);
      expect(Object.isFrozen(after)).toBe(true);
      expect(before.toSnapshot()).toBe(beforeSnapshot);
    },
  );

  it('sets suspension as current state and clears it on resume', (): void => {
    const suspended = createAccount().suspend({ expectedVersion: 1, occurredAt: T1 }).account;
    const resumed = suspended.resume({ expectedVersion: 2, occurredAt: T2 }).account;

    expect(suspended.toSnapshot()).toEqual(suspendedSnapshot());
    expect(resumed.toSnapshot()).toEqual(resumedSnapshot());
  });

  it('clears suspension and sets terminal time when deactivating a Suspended account', (): void => {
    const suspended = createAccount().suspend({ expectedVersion: 1, occurredAt: T1 }).account;
    const deactivated = suspended.deactivate({ expectedVersion: 2, occurredAt: T2 }).account;

    expect(deactivated.toSnapshot()).toEqual(
      deactivatedSnapshot({ version: 3, updatedAt: T2, deactivatedAt: T2 }),
    );
  });

  it.each([
    ['ACTIVE', 'resume'],
    ['SUSPENDED', 'suspend'],
    ['DEACTIVATED', 'suspend'],
    ['DEACTIVATED', 'resume'],
    ['DEACTIVATED', 'deactivate'],
  ] as const)('rejects %s to %s', (status, action): void => {
    expect(() => performLifecycle(accountInStatus(status), action)).toThrow(
      IdentityAccountLifecycleConflictError,
    );
  });

  it('keeps state immutable and errors cause-free and PII-safe on every rejection class', (): void => {
    const maximumVersionAccount = IdentityAccount.rehydrate(
      activeSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION, updatedAt: T1 }),
    );
    const failures: readonly {
      account: IdentityAccount;
      expectedError: ErrorClass;
      operation: (account: IdentityAccount) => unknown;
    }[] = [
      {
        account: createAccount(),
        expectedError: IdentityAccountVersionMismatchError,
        operation: (account) => account.suspend({ expectedVersion: 2, occurredAt: T1 }),
      },
      {
        account: createAccount(),
        expectedError: IdentityAccountLifecycleConflictError,
        operation: (account) => account.resume({ expectedVersion: 1, occurredAt: T1 }),
      },
      {
        account: createAccount(),
        expectedError: IdentityAccountTimestampRegressionError,
        operation: (account) => account.suspend({ expectedVersion: 1, occurredAt: BEFORE_T0 }),
      },
      {
        account: maximumVersionAccount,
        expectedError: IdentityAggregateVersionExhaustedError,
        operation: (account) =>
          account.suspend({
            expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
            occurredAt: T2,
          }),
      },
    ];

    for (const failure of failures) {
      const snapshotBefore = failure.account.toSnapshot();
      const error = captureError(() => failure.operation(failure.account));

      expect(error).toBeInstanceOf(failure.expectedError);
      expect(String(error)).not.toContain(ACCOUNT_ID);
      expect(String(error)).not.toContain(LOGIN_NAME);
      expect(JSON.stringify(error)).not.toContain(ACCOUNT_ID);
      expect(JSON.stringify(error)).not.toContain(LOGIN_NAME);
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(failure.account.toSnapshot()).toBe(snapshotBefore);
      expect(Object.isFrozen(snapshotBefore)).toBe(true);
    }
  });

  it.each(['suspend', 'resume', 'deactivate'] as const)(
    'checks optimistic version before lifecycle, time, and capacity for %s',
    (action): void => {
      const account = IdentityAccount.rehydrate(
        activeSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION, updatedAt: T1 }),
      );

      expect(() => performLifecycle(account, action, 'not-an-instant', 1)).toThrow(
        IdentityAccountVersionMismatchError,
      );
    },
  );

  it('checks lifecycle before parsing mutation time', (): void => {
    expect(() =>
      createAccount().resume({ expectedVersion: 1, occurredAt: 'not-an-instant' }),
    ).toThrow(IdentityAccountLifecycleConflictError);
  });

  it('checks time regression before version capacity', (): void => {
    const account = IdentityAccount.rehydrate(
      activeSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION, updatedAt: T1 }),
    );

    expect(() =>
      account.suspend({
        expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
        occurredAt: T0,
      }),
    ).toThrow(IdentityAccountTimestampRegressionError);
  });

  it('rejects exhausted aggregate version capacity', (): void => {
    const account = IdentityAccount.rehydrate(
      activeSnapshot({ version: MAX_IDENTITY_AGGREGATE_VERSION, updatedAt: T1 }),
    );

    expect(() =>
      account.suspend({
        expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
        occurredAt: T2,
      }),
    ).toThrow(IdentityAggregateVersionExhaustedError);
  });

  it.each([0, 1.5, '1', null])(
    'rejects an invalid expected version %p before comparing it',
    (expectedVersion): void => {
      expect(() => createAccount().suspend({ expectedVersion, occurredAt: T1 })).toThrow(
        InvalidIdentityAggregateVersionError,
      );
    },
  );

  it('rejects a malformed mutation instant on an otherwise valid transition', (): void => {
    expect(() =>
      createAccount().suspend({ expectedVersion: 1, occurredAt: 'not-an-instant' }),
    ).toThrow(InvalidIdentityInstantError);
  });

  it('accepts an equal authoritative database instant', (): void => {
    const result = createAccount().suspend({ expectedVersion: 1, occurredAt: T0 });

    expect(result.account.toSnapshot()).toEqual(
      suspendedSnapshot({ updatedAt: T0, suspendedAt: T0 }),
    );
  });
});
