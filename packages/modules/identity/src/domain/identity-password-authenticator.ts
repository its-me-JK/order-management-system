import { parseIdentityAccountId, type IdentityAccountId } from './identity-account.values';
import {
  IdentityPasswordAuthenticatorDeadlineOverflowError,
  IdentityPasswordAuthenticatorLifecycleConflictError,
  IdentityPasswordAuthenticatorSamePhcError,
  IdentityPasswordAuthenticatorTimestampRegressionError,
  IdentityPasswordAuthenticatorVerificationNotPermittedError,
  IdentityPasswordAuthenticatorVerificationSnapshotMismatchError,
  IdentityPasswordAuthenticatorVersionMismatchError,
  InvalidIdentityPasswordAuthenticatorStateError,
} from './identity-password-authenticator.errors';
import type {
  IdentityPasswordAuthenticatorCreationFacts,
  IdentityPasswordAuthenticatorFailedVerificationFacts,
  IdentityPasswordAuthenticatorRebindFacts,
  IdentityPasswordAuthenticatorSuccessfulVerificationFacts,
} from './identity-password-authenticator.facts';
import {
  identityPasswordPhcsEqual,
  parseIdentityPasswordPhc,
  type IdentityPasswordPhc,
} from './identity-password-phc';
import {
  MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT,
  parseIdentityConsecutiveFailureCount,
  parseIdentityPasswordAuthenticatorStatus,
  type IdentityConsecutiveFailureCount,
  type IdentityPasswordAuthenticatorStatus,
} from './identity-password-authenticator.values';
import {
  compareIdentityInstants,
  nextIdentityAggregateVersion,
  parseIdentityAggregateVersion,
  parseIdentityInstant,
  tryAddIdentitySeconds,
  type IdentityAggregateVersion,
  type IdentityInstant,
} from './identity-values';

const IDENTITY_PASSWORD_AUTHENTICATOR_SNAPSHOT_KEYS = Object.freeze([
  'accountId',
  'passwordPhc',
  'status',
  'version',
  'consecutiveFailureCount',
  'nextVerificationAt',
  'disabledAt',
  'createdAt',
  'updatedAt',
  'passwordChangedAt',
] as const);

const IDENTITY_PASSWORD_VERIFICATION_BASIS_KEYS = Object.freeze([
  'accountId',
  'version',
  'passwordPhc',
  'nextVerificationAt',
] as const);

const EMPTY_FACTS: readonly [] = Object.freeze([]);
const VERIFY_DUMMY_PASSWORD_PLAN = Object.freeze({ kind: 'VERIFY_DUMMY_PASSWORD' } as const);

type IdentityPasswordAuthenticatorFactTuple =
  | IdentityPasswordAuthenticatorCreationFacts
  | IdentityPasswordAuthenticatorFailedVerificationFacts
  | IdentityPasswordAuthenticatorSuccessfulVerificationFacts
  | IdentityPasswordAuthenticatorRebindFacts;

export type IdentityPasswordAuthenticatorSnapshot = Readonly<{
  accountId: IdentityAccountId;
  passwordPhc: IdentityPasswordPhc;
  status: IdentityPasswordAuthenticatorStatus;
  version: IdentityAggregateVersion;
  consecutiveFailureCount: IdentityConsecutiveFailureCount;
  nextVerificationAt: IdentityInstant | null;
  disabledAt: IdentityInstant | null;
  createdAt: IdentityInstant;
  updatedAt: IdentityInstant;
  passwordChangedAt: IdentityInstant;
}>;

export type IdentityPasswordVerificationBasis = Readonly<{
  accountId: IdentityAccountId;
  version: IdentityAggregateVersion;
  passwordPhc: IdentityPasswordPhc;
  nextVerificationAt: IdentityInstant | null;
}>;

export type IdentityPasswordVerificationPlan =
  | Readonly<{
      kind: 'VERIFY_PRESENTED_PASSWORD';
      basis: IdentityPasswordVerificationBasis;
    }>
  | typeof VERIFY_DUMMY_PASSWORD_PLAN;

export type CreateIdentityPasswordAuthenticatorInput = Readonly<{
  accountId: unknown;
  passwordPhc: unknown;
  occurredAt: unknown;
}>;

export type PrepareIdentityPasswordVerificationInput = Readonly<{
  observedAt: unknown;
}>;

export type RecordIdentityPasswordVerificationInput = Readonly<{
  basis: unknown;
  occurredAt: unknown;
}>;

export type RecordSuccessfulIdentityPasswordVerificationInput =
  RecordIdentityPasswordVerificationInput &
    Readonly<{
      upgradedPasswordPhc: unknown;
    }>;

export type RebindIdentityPasswordAuthenticatorInput = Readonly<{
  expectedVersion: unknown;
  newPasswordPhc: unknown;
  occurredAt: unknown;
}>;

export type IdentityPasswordAuthenticatorChangedResult<
  Facts extends IdentityPasswordAuthenticatorFactTuple = IdentityPasswordAuthenticatorFactTuple,
> = Readonly<{
  kind: 'changed';
  authenticator: IdentityPasswordAuthenticator;
  facts: Facts;
}>;

export type IdentityPasswordAuthenticatorUnchangedResult = Readonly<{
  kind: 'unchanged';
  authenticator: IdentityPasswordAuthenticator;
  facts: readonly [];
}>;

export type IdentityPasswordAuthenticatorSuccessfulVerificationResult =
  | IdentityPasswordAuthenticatorChangedResult<IdentityPasswordAuthenticatorSuccessfulVerificationFacts>
  | IdentityPasswordAuthenticatorUnchangedResult;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => expectedKeys.some((expected) => expected === key))
  );
}

function parseNullableIdentityInstant(value: unknown): IdentityInstant | null {
  return value === null ? null : parseIdentityInstant(value);
}

function freezeSnapshot(
  snapshot: IdentityPasswordAuthenticatorSnapshot,
): IdentityPasswordAuthenticatorSnapshot {
  return Object.freeze({ ...snapshot });
}

function invalidSnapshot(): never {
  throw new InvalidIdentityPasswordAuthenticatorStateError();
}

function addCooldownSeconds(instant: IdentityInstant, secondsToAdd: number): IdentityInstant {
  const deadline = tryAddIdentitySeconds(instant, secondsToAdd);

  if (deadline === null) {
    throw new IdentityPasswordAuthenticatorDeadlineOverflowError();
  }

  return deadline;
}

function cooldownSeconds(failureCount: IdentityConsecutiveFailureCount): number | null {
  if (failureCount < 5 || failureCount === MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT) {
    return null;
  }

  if (failureCount >= 15) {
    return 900;
  }

  return 2 ** (failureCount - 5);
}

function calculateNextVerificationAt(
  updatedAt: IdentityInstant,
  failureCount: IdentityConsecutiveFailureCount,
): IdentityInstant | null {
  const seconds = cooldownSeconds(failureCount);

  return seconds === null ? null : addCooldownSeconds(updatedAt, seconds);
}

function assertSnapshotChronology(snapshot: IdentityPasswordAuthenticatorSnapshot): void {
  if (
    compareIdentityInstants(snapshot.createdAt, snapshot.updatedAt) > 0 ||
    compareIdentityInstants(snapshot.createdAt, snapshot.passwordChangedAt) > 0 ||
    compareIdentityInstants(snapshot.passwordChangedAt, snapshot.updatedAt) > 0 ||
    (snapshot.disabledAt !== null &&
      (compareIdentityInstants(snapshot.createdAt, snapshot.disabledAt) > 0 ||
        compareIdentityInstants(snapshot.disabledAt, snapshot.updatedAt) > 0))
  ) {
    invalidSnapshot();
  }
}

function assertSnapshotState(snapshot: IdentityPasswordAuthenticatorSnapshot): void {
  switch (snapshot.status) {
    case 'ACTIVE': {
      if (
        snapshot.consecutiveFailureCount === MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT ||
        snapshot.disabledAt !== null ||
        (snapshot.consecutiveFailureCount > 0 &&
          snapshot.version < snapshot.consecutiveFailureCount + 1) ||
        (snapshot.version === 1 &&
          (snapshot.consecutiveFailureCount !== 0 ||
            snapshot.updatedAt !== snapshot.createdAt ||
            snapshot.passwordChangedAt !== snapshot.createdAt))
      ) {
        invalidSnapshot();
      }

      const expectedDeadline = calculateNextVerificationAt(
        snapshot.updatedAt,
        snapshot.consecutiveFailureCount,
      );

      if (snapshot.nextVerificationAt !== expectedDeadline) {
        invalidSnapshot();
      }
      return;
    }
    case 'REBIND_REQUIRED':
      if (
        snapshot.consecutiveFailureCount !== MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT ||
        snapshot.version < MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT + 1 ||
        snapshot.nextVerificationAt !== null ||
        snapshot.disabledAt === null ||
        snapshot.disabledAt !== snapshot.updatedAt
      ) {
        invalidSnapshot();
      }
  }
}

function parseSnapshot(value: unknown): IdentityPasswordAuthenticatorSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, IDENTITY_PASSWORD_AUTHENTICATOR_SNAPSHOT_KEYS)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    accountId: parseIdentityAccountId(value['accountId']),
    passwordPhc: parseIdentityPasswordPhc(value['passwordPhc']),
    status: parseIdentityPasswordAuthenticatorStatus(value['status']),
    version: parseIdentityAggregateVersion(value['version']),
    consecutiveFailureCount: parseIdentityConsecutiveFailureCount(value['consecutiveFailureCount']),
    nextVerificationAt: parseNullableIdentityInstant(value['nextVerificationAt']),
    disabledAt: parseNullableIdentityInstant(value['disabledAt']),
    createdAt: parseIdentityInstant(value['createdAt']),
    updatedAt: parseIdentityInstant(value['updatedAt']),
    passwordChangedAt: parseIdentityInstant(value['passwordChangedAt']),
  });

  assertSnapshotChronology(snapshot);
  assertSnapshotState(snapshot);

  return snapshot;
}

function parseVerificationBasis(value: unknown): IdentityPasswordVerificationBasis {
  try {
    if (!isRecord(value) || !hasExactKeys(value, IDENTITY_PASSWORD_VERIFICATION_BASIS_KEYS)) {
      throw new IdentityPasswordAuthenticatorVerificationSnapshotMismatchError();
    }

    return Object.freeze({
      accountId: parseIdentityAccountId(value['accountId']),
      version: parseIdentityAggregateVersion(value['version']),
      passwordPhc: parseIdentityPasswordPhc(value['passwordPhc']),
      nextVerificationAt: parseNullableIdentityInstant(value['nextVerificationAt']),
    });
  } catch {
    throw new IdentityPasswordAuthenticatorVerificationSnapshotMismatchError();
  }
}

function freezeFacts<Facts extends IdentityPasswordAuthenticatorFactTuple>(facts: Facts): Facts {
  return Object.freeze(facts.map((fact) => Object.freeze(fact))) as unknown as Facts;
}

function changed<Facts extends IdentityPasswordAuthenticatorFactTuple>(
  authenticator: IdentityPasswordAuthenticator,
  facts: Facts,
): IdentityPasswordAuthenticatorChangedResult<Facts> {
  return Object.freeze({ kind: 'changed', authenticator, facts: freezeFacts(facts) });
}

function unchanged(
  authenticator: IdentityPasswordAuthenticator,
): IdentityPasswordAuthenticatorUnchangedResult {
  return Object.freeze({ kind: 'unchanged', authenticator, facts: EMPTY_FACTS });
}

/** Framework-free password verifier state; raw passwords and Argon2 work stay outside it. */
export class IdentityPasswordAuthenticator {
  readonly #snapshot: IdentityPasswordAuthenticatorSnapshot;

  private constructor(snapshot: IdentityPasswordAuthenticatorSnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  public static create(
    input: CreateIdentityPasswordAuthenticatorInput,
  ): IdentityPasswordAuthenticatorChangedResult<IdentityPasswordAuthenticatorCreationFacts> {
    const occurredAt = parseIdentityInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      accountId: parseIdentityAccountId(input.accountId),
      passwordPhc: parseIdentityPasswordPhc(input.passwordPhc),
      status: 'ACTIVE',
      version: parseIdentityAggregateVersion(1),
      consecutiveFailureCount: parseIdentityConsecutiveFailureCount(0),
      nextVerificationAt: null,
      disabledAt: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      passwordChangedAt: occurredAt,
    });
    const authenticator = new IdentityPasswordAuthenticator(snapshot);

    return changed(authenticator, [
      {
        type: 'PASSWORD_AUTHENTICATOR_CREATED',
        accountId: snapshot.accountId,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      },
    ]);
  }

  /** Rebuilds authoritative state without replaying historical domain facts. */
  public static rehydrate(value: unknown): IdentityPasswordAuthenticator {
    try {
      return new IdentityPasswordAuthenticator(parseSnapshot(value));
    } catch {
      throw new InvalidIdentityPasswordAuthenticatorStateError();
    }
  }

  public toSnapshot(): IdentityPasswordAuthenticatorSnapshot {
    return this.#snapshot;
  }

  public prepareVerification(
    input: PrepareIdentityPasswordVerificationInput,
  ): IdentityPasswordVerificationPlan {
    const observedAt = this.observedInstant(input.observedAt);

    if (
      this.#snapshot.status === 'REBIND_REQUIRED' ||
      (this.#snapshot.nextVerificationAt !== null &&
        compareIdentityInstants(observedAt, this.#snapshot.nextVerificationAt) < 0)
    ) {
      return VERIFY_DUMMY_PASSWORD_PLAN;
    }

    const basis = Object.freeze({
      accountId: this.#snapshot.accountId,
      version: this.#snapshot.version,
      passwordPhc: this.#snapshot.passwordPhc,
      nextVerificationAt: this.#snapshot.nextVerificationAt,
    });

    return Object.freeze({ kind: 'VERIFY_PRESENTED_PASSWORD', basis });
  }

  public recordFailedVerification(
    input: RecordIdentityPasswordVerificationInput,
  ): IdentityPasswordAuthenticatorChangedResult<IdentityPasswordAuthenticatorFailedVerificationFacts> {
    this.assertVerificationBasis(input.basis);
    this.assertVerificationCanBeRecorded();
    const occurredAt = this.mutationInstant(input.occurredAt);
    this.assertCooldownEligibility(occurredAt);
    const nextFailureCount = parseIdentityConsecutiveFailureCount(
      this.#snapshot.consecutiveFailureCount + 1,
    );
    const nextVersion = nextIdentityAggregateVersion(this.#snapshot.version);

    if (nextFailureCount === MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT) {
      const snapshot = freezeSnapshot({
        ...this.#snapshot,
        status: 'REBIND_REQUIRED',
        version: nextVersion,
        consecutiveFailureCount: nextFailureCount,
        nextVerificationAt: null,
        disabledAt: occurredAt,
        updatedAt: occurredAt,
      });
      const authenticator = new IdentityPasswordAuthenticator(snapshot);

      return changed(authenticator, [
        {
          type: 'PASSWORD_VERIFICATION_REJECTED',
          accountId: snapshot.accountId,
          status: 'REBIND_REQUIRED',
          version: snapshot.version,
          occurredAt,
        },
        {
          type: 'PASSWORD_AUTHENTICATOR_DISABLED',
          accountId: snapshot.accountId,
          status: 'REBIND_REQUIRED',
          version: snapshot.version,
          occurredAt,
        },
      ]);
    }

    const nextVerificationAt = calculateNextVerificationAt(occurredAt, nextFailureCount);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      version: nextVersion,
      consecutiveFailureCount: nextFailureCount,
      nextVerificationAt,
      updatedAt: occurredAt,
    });
    const authenticator = new IdentityPasswordAuthenticator(snapshot);

    return changed(authenticator, [
      {
        type: 'PASSWORD_VERIFICATION_REJECTED',
        accountId: snapshot.accountId,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      },
    ]);
  }

  public recordSuccessfulVerification(
    input: RecordSuccessfulIdentityPasswordVerificationInput,
  ): IdentityPasswordAuthenticatorSuccessfulVerificationResult {
    this.assertVerificationBasis(input.basis);
    this.assertVerificationCanBeRecorded();
    const occurredAt = this.mutationInstant(input.occurredAt);
    this.assertCooldownEligibility(occurredAt);
    const upgradedPasswordPhc =
      input.upgradedPasswordPhc === null
        ? null
        : parseIdentityPasswordPhc(input.upgradedPasswordPhc);
    const resetsFailures = this.#snapshot.consecutiveFailureCount > 0;
    const upgradesVerifier =
      upgradedPasswordPhc !== null &&
      !identityPasswordPhcsEqual(this.#snapshot.passwordPhc, upgradedPasswordPhc);

    if (!resetsFailures && !upgradesVerifier) {
      return unchanged(this);
    }

    const nextVersion = nextIdentityAggregateVersion(this.#snapshot.version);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      passwordPhc: upgradesVerifier ? upgradedPasswordPhc : this.#snapshot.passwordPhc,
      version: nextVersion,
      consecutiveFailureCount: parseIdentityConsecutiveFailureCount(0),
      nextVerificationAt: null,
      updatedAt: occurredAt,
    });
    const authenticator = new IdentityPasswordAuthenticator(snapshot);
    const factFields = {
      accountId: snapshot.accountId,
      status: 'ACTIVE',
      version: snapshot.version,
      occurredAt,
    } as const;

    if (resetsFailures && upgradesVerifier) {
      return changed(authenticator, [
        { type: 'PASSWORD_AUTHENTICATOR_FAILURES_RESET', ...factFields },
        { type: 'PASSWORD_AUTHENTICATOR_VERIFIER_UPGRADED', ...factFields },
      ]);
    }

    if (resetsFailures) {
      return changed(authenticator, [
        { type: 'PASSWORD_AUTHENTICATOR_FAILURES_RESET', ...factFields },
      ]);
    }

    return changed(authenticator, [
      { type: 'PASSWORD_AUTHENTICATOR_VERIFIER_UPGRADED', ...factFields },
    ]);
  }

  public rebind(
    input: RebindIdentityPasswordAuthenticatorInput,
  ): IdentityPasswordAuthenticatorChangedResult<IdentityPasswordAuthenticatorRebindFacts> {
    this.assertExpectedVersion(input.expectedVersion);

    if (this.#snapshot.status !== 'REBIND_REQUIRED') {
      throw new IdentityPasswordAuthenticatorLifecycleConflictError();
    }

    const occurredAt = this.mutationInstant(input.occurredAt);
    const newPasswordPhc = parseIdentityPasswordPhc(input.newPasswordPhc);

    if (identityPasswordPhcsEqual(this.#snapshot.passwordPhc, newPasswordPhc)) {
      throw new IdentityPasswordAuthenticatorSamePhcError();
    }

    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      passwordPhc: newPasswordPhc,
      status: 'ACTIVE',
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      consecutiveFailureCount: parseIdentityConsecutiveFailureCount(0),
      nextVerificationAt: null,
      disabledAt: null,
      updatedAt: occurredAt,
      passwordChangedAt: occurredAt,
    });
    const authenticator = new IdentityPasswordAuthenticator(snapshot);

    return changed(authenticator, [
      {
        type: 'PASSWORD_AUTHENTICATOR_REBOUND',
        accountId: snapshot.accountId,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      },
    ]);
  }

  private assertVerificationBasis(value: unknown): void {
    const basis = parseVerificationBasis(value);

    if (
      basis.accountId !== this.#snapshot.accountId ||
      basis.version !== this.#snapshot.version ||
      !identityPasswordPhcsEqual(basis.passwordPhc, this.#snapshot.passwordPhc) ||
      basis.nextVerificationAt !== this.#snapshot.nextVerificationAt
    ) {
      throw new IdentityPasswordAuthenticatorVerificationSnapshotMismatchError();
    }
  }

  private assertVerificationCanBeRecorded(): void {
    if (this.#snapshot.status !== 'ACTIVE') {
      throw new IdentityPasswordAuthenticatorVerificationNotPermittedError();
    }
  }

  private assertExpectedVersion(value: unknown): void {
    const expectedVersion = parseIdentityAggregateVersion(value);

    if (expectedVersion !== this.#snapshot.version) {
      throw new IdentityPasswordAuthenticatorVersionMismatchError();
    }
  }

  private observedInstant(value: unknown): IdentityInstant {
    const observedAt = parseIdentityInstant(value);

    if (compareIdentityInstants(observedAt, this.#snapshot.updatedAt) < 0) {
      throw new IdentityPasswordAuthenticatorTimestampRegressionError();
    }

    return observedAt;
  }

  private mutationInstant(value: unknown): IdentityInstant {
    return this.observedInstant(value);
  }

  private assertCooldownEligibility(occurredAt: IdentityInstant): void {
    if (
      this.#snapshot.nextVerificationAt !== null &&
      compareIdentityInstants(occurredAt, this.#snapshot.nextVerificationAt) < 0
    ) {
      throw new IdentityPasswordAuthenticatorVerificationNotPermittedError();
    }
  }
}
