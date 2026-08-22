import {
  IdentityAccountLifecycleConflictError,
  IdentityAccountTimestampRegressionError,
  IdentityAccountVersionMismatchError,
  InvalidIdentityAccountStateError,
} from './identity-account.errors';
import type {
  IdentityAccountCreatedFact,
  IdentityAccountDeactivatedFact,
  IdentityAccountDomainFact,
  IdentityAccountResumedFact,
  IdentityAccountSuspendedFact,
} from './identity-account.facts';
import {
  parseIdentityAccountId,
  parseIdentityAccountStatus,
  parseIdentityLoginName,
  type IdentityAccountId,
  type IdentityAccountStatus,
  type IdentityLoginName,
} from './identity-account.values';
import {
  compareIdentityInstants,
  nextIdentityAggregateVersion,
  parseIdentityAggregateVersion,
  parseIdentityInstant,
  type IdentityAggregateVersion,
  type IdentityInstant,
} from './identity-values';

const IDENTITY_ACCOUNT_SNAPSHOT_KEYS = Object.freeze([
  'id',
  'loginName',
  'status',
  'version',
  'createdAt',
  'updatedAt',
  'suspendedAt',
  'deactivatedAt',
] as const);

export type IdentityAccountSnapshot = Readonly<{
  id: IdentityAccountId;
  loginName: IdentityLoginName | null;
  status: IdentityAccountStatus;
  version: IdentityAggregateVersion;
  createdAt: IdentityInstant;
  updatedAt: IdentityInstant;
  suspendedAt: IdentityInstant | null;
  deactivatedAt: IdentityInstant | null;
}>;

export type CreateIdentityAccountInput = Readonly<{
  id: unknown;
  loginName: unknown;
  occurredAt: unknown;
}>;

export type TransitionIdentityAccountInput = Readonly<{
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type IdentityAccountChangedResult<
  Fact extends IdentityAccountDomainFact = IdentityAccountDomainFact,
> = Readonly<{
  kind: 'changed';
  account: IdentityAccount;
  fact: Fact;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactSnapshotKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === IDENTITY_ACCOUNT_SNAPSHOT_KEYS.length &&
    keys.every((key) => IDENTITY_ACCOUNT_SNAPSHOT_KEYS.some((expected) => expected === key))
  );
}

function parseNullableIdentityInstant(value: unknown): IdentityInstant | null {
  return value === null ? null : parseIdentityInstant(value);
}

function parseNullableIdentityLoginName(value: unknown): IdentityLoginName | null {
  return value === null ? null : parseIdentityLoginName(value);
}

function freezeSnapshot(snapshot: IdentityAccountSnapshot): IdentityAccountSnapshot {
  return Object.freeze({ ...snapshot });
}

function invalidSnapshot(): never {
  throw new InvalidIdentityAccountStateError();
}

function assertSnapshotChronology(snapshot: IdentityAccountSnapshot): void {
  if (
    compareIdentityInstants(snapshot.createdAt, snapshot.updatedAt) > 0 ||
    (snapshot.suspendedAt !== null &&
      (compareIdentityInstants(snapshot.createdAt, snapshot.suspendedAt) > 0 ||
        compareIdentityInstants(snapshot.suspendedAt, snapshot.updatedAt) > 0)) ||
    (snapshot.deactivatedAt !== null &&
      (compareIdentityInstants(snapshot.createdAt, snapshot.deactivatedAt) > 0 ||
        compareIdentityInstants(snapshot.deactivatedAt, snapshot.updatedAt) > 0))
  ) {
    invalidSnapshot();
  }
}

function assertSnapshotLifecycle(snapshot: IdentityAccountSnapshot): void {
  switch (snapshot.status) {
    case 'ACTIVE':
      if (
        snapshot.loginName === null ||
        snapshot.suspendedAt !== null ||
        snapshot.deactivatedAt !== null ||
        snapshot.version % 2 === 0 ||
        (snapshot.version === 1 && snapshot.updatedAt !== snapshot.createdAt)
      ) {
        invalidSnapshot();
      }
      return;
    case 'SUSPENDED':
      if (
        snapshot.loginName === null ||
        snapshot.version < 2 ||
        snapshot.version % 2 !== 0 ||
        snapshot.suspendedAt === null ||
        snapshot.suspendedAt !== snapshot.updatedAt ||
        snapshot.deactivatedAt !== null
      ) {
        invalidSnapshot();
      }
      return;
    case 'DEACTIVATED':
      if (
        snapshot.version < 2 ||
        snapshot.suspendedAt !== null ||
        snapshot.deactivatedAt === null ||
        (snapshot.loginName === null
          ? snapshot.version < 3
          : snapshot.deactivatedAt !== snapshot.updatedAt)
      ) {
        invalidSnapshot();
      }
  }
}

function parseSnapshot(value: unknown): IdentityAccountSnapshot {
  if (!isRecord(value) || !hasExactSnapshotKeys(value)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    id: parseIdentityAccountId(value['id']),
    loginName: parseNullableIdentityLoginName(value['loginName']),
    status: parseIdentityAccountStatus(value['status']),
    version: parseIdentityAggregateVersion(value['version']),
    createdAt: parseIdentityInstant(value['createdAt']),
    updatedAt: parseIdentityInstant(value['updatedAt']),
    suspendedAt: parseNullableIdentityInstant(value['suspendedAt']),
    deactivatedAt: parseNullableIdentityInstant(value['deactivatedAt']),
  });

  assertSnapshotChronology(snapshot);
  assertSnapshotLifecycle(snapshot);

  return snapshot;
}

function changed<Fact extends IdentityAccountDomainFact>(
  account: IdentityAccount,
  fact: Fact,
): IdentityAccountChangedResult<Fact> {
  return Object.freeze({ kind: 'changed', account, fact: Object.freeze(fact) });
}

/** Framework-free Account aggregate. Every lifecycle mutation returns a new immutable value. */
export class IdentityAccount {
  readonly #snapshot: IdentityAccountSnapshot;

  private constructor(snapshot: IdentityAccountSnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  public static create(
    input: CreateIdentityAccountInput,
  ): IdentityAccountChangedResult<IdentityAccountCreatedFact> {
    const occurredAt = parseIdentityInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      id: parseIdentityAccountId(input.id),
      loginName: parseIdentityLoginName(input.loginName),
      status: 'ACTIVE',
      version: parseIdentityAggregateVersion(1),
      createdAt: occurredAt,
      updatedAt: occurredAt,
      suspendedAt: null,
      deactivatedAt: null,
    });
    const account = new IdentityAccount(snapshot);

    return changed(account, {
      type: 'ACCOUNT_CREATED',
      accountId: snapshot.id,
      status: 'ACTIVE',
      version: snapshot.version,
      occurredAt,
    });
  }

  /** Rebuilds authoritative state without replaying historical domain facts. */
  public static rehydrate(value: unknown): IdentityAccount {
    try {
      return new IdentityAccount(parseSnapshot(value));
    } catch {
      throw new InvalidIdentityAccountStateError();
    }
  }

  public toSnapshot(): IdentityAccountSnapshot {
    return this.#snapshot;
  }

  public suspend(
    input: TransitionIdentityAccountInput,
  ): IdentityAccountChangedResult<IdentityAccountSuspendedFact> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertStatus('ACTIVE');
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'SUSPENDED',
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      suspendedAt: occurredAt,
    });
    const account = new IdentityAccount(snapshot);

    return changed(account, {
      type: 'ACCOUNT_SUSPENDED',
      accountId: snapshot.id,
      previousStatus: 'ACTIVE',
      status: 'SUSPENDED',
      version: snapshot.version,
      occurredAt,
    });
  }

  public resume(
    input: TransitionIdentityAccountInput,
  ): IdentityAccountChangedResult<IdentityAccountResumedFact> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertStatus('SUSPENDED');
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'ACTIVE',
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      suspendedAt: null,
    });
    const account = new IdentityAccount(snapshot);

    return changed(account, {
      type: 'ACCOUNT_RESUMED',
      accountId: snapshot.id,
      previousStatus: 'SUSPENDED',
      status: 'ACTIVE',
      version: snapshot.version,
      occurredAt,
    });
  }

  public deactivate(
    input: TransitionIdentityAccountInput,
  ): IdentityAccountChangedResult<IdentityAccountDeactivatedFact> {
    this.assertExpectedVersion(input.expectedVersion);
    const previousStatus = this.nonDeactivatedStatus();
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'DEACTIVATED',
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      suspendedAt: null,
      deactivatedAt: occurredAt,
    });
    const account = new IdentityAccount(snapshot);

    return changed(account, {
      type: 'ACCOUNT_DEACTIVATED',
      accountId: snapshot.id,
      previousStatus,
      status: 'DEACTIVATED',
      version: snapshot.version,
      occurredAt,
    });
  }

  private assertExpectedVersion(value: unknown): void {
    const expectedVersion = parseIdentityAggregateVersion(value);

    if (expectedVersion !== this.#snapshot.version) {
      throw new IdentityAccountVersionMismatchError();
    }
  }

  private assertStatus(required: IdentityAccountStatus): void {
    if (this.#snapshot.status !== required) {
      throw new IdentityAccountLifecycleConflictError();
    }
  }

  private nonDeactivatedStatus(): Exclude<IdentityAccountStatus, 'DEACTIVATED'> {
    if (this.#snapshot.status === 'DEACTIVATED') {
      throw new IdentityAccountLifecycleConflictError();
    }

    return this.#snapshot.status;
  }

  private mutationInstant(value: unknown): IdentityInstant {
    const occurredAt = parseIdentityInstant(value);

    if (compareIdentityInstants(occurredAt, this.#snapshot.updatedAt) < 0) {
      throw new IdentityAccountTimestampRegressionError();
    }

    return occurredAt;
  }
}
