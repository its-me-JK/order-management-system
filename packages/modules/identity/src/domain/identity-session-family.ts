import { parseIdentityAccountId, type IdentityAccountId } from './identity-account.values';
import {
  IdentitySessionFamilyDeadlineOverflowError,
  IdentitySessionFamilyTimestampRegressionError,
  InvalidIdentitySessionFamilyStateError,
} from './identity-session-family.errors';
import type {
  IdentitySessionFamilyCreationFacts,
  IdentitySessionFamilyFactTuple,
  IdentitySessionFamilyGenericRevocationFacts,
} from './identity-session-family.facts';
import {
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
  type IdentitySessionFamilyAuthenticationState,
  type IdentitySessionFamilyClosedReason,
  type IdentitySessionId,
} from './identity-session-family.values';
import {
  compareIdentityInstants,
  nextIdentityAggregateVersion,
  parseIdentityAggregateVersion,
  parseIdentityInstant,
  tryAddIdentitySeconds,
  type IdentityAggregateVersion,
  type IdentityInstant,
} from './identity-values';

const IDENTITY_SESSION_FAMILY_SNAPSHOT_KEYS = Object.freeze([
  'id',
  'accountId',
  'version',
  'createdAt',
  'lastRotatedAt',
  'refreshIdleExpiresAt',
  'refreshAbsoluteExpiresAt',
  'revokedAt',
  'closedReason',
] as const);
const EMPTY_IDENTITY_SESSION_FAMILY_FACTS: readonly [] = Object.freeze([]);
const ROTATION_COUNT_WITH_IMPLICIT_ABSOLUTE_BOUND = Math.ceil(
  MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS / MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
);

export type IdentitySessionFamilySnapshot = Readonly<{
  id: IdentitySessionId;
  accountId: IdentityAccountId;
  version: IdentityAggregateVersion;
  createdAt: IdentityInstant;
  lastRotatedAt: IdentityInstant;
  refreshIdleExpiresAt: IdentityInstant;
  refreshAbsoluteExpiresAt: IdentityInstant;
  revokedAt: IdentityInstant | null;
  closedReason: IdentitySessionFamilyClosedReason | null;
}>;

export type CreateIdentitySessionFamilyInput = Readonly<{
  id: unknown;
  accountId: unknown;
  refreshIdleLifetimeSeconds: unknown;
  refreshAbsoluteLifetimeSeconds: unknown;
  occurredAt: unknown;
}>;

export type ObserveIdentitySessionFamilyAuthenticationInput = Readonly<{
  observedAt: unknown;
}>;

export type RevokeIdentitySessionFamilyInput = Readonly<{
  closedReason: unknown;
  occurredAt: unknown;
}>;

export type IdentitySessionFamilyChangedResult<
  Facts extends IdentitySessionFamilyFactTuple = IdentitySessionFamilyFactTuple,
> = Readonly<{
  kind: 'changed';
  sessionFamily: IdentitySessionFamily;
  facts: Facts;
}>;

export type IdentitySessionFamilyUnchangedResult = Readonly<{
  kind: 'unchanged';
  sessionFamily: IdentitySessionFamily;
  facts: readonly [];
}>;

export type IdentitySessionFamilyMutationResult<
  Facts extends IdentitySessionFamilyFactTuple = IdentitySessionFamilyFactTuple,
> = IdentitySessionFamilyChangedResult<Facts> | IdentitySessionFamilyUnchangedResult;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactSnapshotKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === IDENTITY_SESSION_FAMILY_SNAPSHOT_KEYS.length &&
    keys.every((key) => IDENTITY_SESSION_FAMILY_SNAPSHOT_KEYS.some((expected) => expected === key))
  );
}

function parseNullableIdentityInstant(value: unknown): IdentityInstant | null {
  return value === null ? null : parseIdentityInstant(value);
}

function parseNullableClosedReason(value: unknown): IdentitySessionFamilyClosedReason | null {
  return value === null ? null : parseIdentitySessionFamilyClosedReason(value);
}

function freezeSnapshot(snapshot: IdentitySessionFamilySnapshot): IdentitySessionFamilySnapshot {
  return Object.freeze({ ...snapshot });
}

function invalidSnapshot(): never {
  throw new InvalidIdentitySessionFamilyStateError();
}

function hasSameFractionalSecond(left: IdentityInstant, right: IdentityInstant): boolean {
  return left.slice(19, 26) === right.slice(19, 26);
}

function intervalIsAtLeast(
  start: IdentityInstant,
  end: IdentityInstant,
  minimumSeconds: number,
): boolean {
  const minimumEnd = tryAddIdentitySeconds(start, minimumSeconds);

  return minimumEnd !== null && compareIdentityInstants(end, minimumEnd) >= 0;
}

function intervalIsAtMost(
  start: IdentityInstant,
  end: IdentityInstant,
  maximumSeconds: number,
): boolean {
  const maximumEnd = tryAddIdentitySeconds(start, maximumSeconds);

  return maximumEnd === null || compareIdentityInstants(end, maximumEnd) <= 0;
}

function hasValidAbsoluteLifetime(snapshot: IdentitySessionFamilySnapshot): boolean {
  return (
    hasSameFractionalSecond(snapshot.createdAt, snapshot.refreshAbsoluteExpiresAt) &&
    intervalIsAtLeast(
      snapshot.createdAt,
      snapshot.refreshAbsoluteExpiresAt,
      MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
    ) &&
    intervalIsAtMost(
      snapshot.createdAt,
      snapshot.refreshAbsoluteExpiresAt,
      MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS,
    )
  );
}

function hasValidInitialIdleLifetime(snapshot: IdentitySessionFamilySnapshot): boolean {
  return (
    snapshot.lastRotatedAt === snapshot.createdAt &&
    hasSameFractionalSecond(snapshot.createdAt, snapshot.refreshIdleExpiresAt) &&
    intervalIsAtLeast(
      snapshot.createdAt,
      snapshot.refreshIdleExpiresAt,
      MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    ) &&
    intervalIsAtMost(
      snapshot.createdAt,
      snapshot.refreshIdleExpiresAt,
      MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    )
  );
}

function hasValidRotatedIdleLifetime(snapshot: IdentitySessionFamilySnapshot): boolean {
  const isCappedAtAbsolute = snapshot.refreshIdleExpiresAt === snapshot.refreshAbsoluteExpiresAt;
  const minimumSeconds = isCappedAtAbsolute ? 1 : MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS;

  return (
    (isCappedAtAbsolute ||
      hasSameFractionalSecond(snapshot.lastRotatedAt, snapshot.refreshIdleExpiresAt)) &&
    intervalIsAtLeast(snapshot.lastRotatedAt, snapshot.refreshIdleExpiresAt, minimumSeconds) &&
    intervalIsAtMost(
      snapshot.lastRotatedAt,
      snapshot.refreshIdleExpiresAt,
      MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    )
  );
}

function hasReachableLastRotation(
  snapshot: IdentitySessionFamilySnapshot,
  rotationCount: number,
): boolean {
  if (rotationCount >= ROTATION_COUNT_WITH_IMPLICIT_ABSOLUTE_BOUND) {
    return true;
  }

  const latestExclusiveRotation = tryAddIdentitySeconds(
    snapshot.createdAt,
    rotationCount * MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
  );

  return (
    latestExclusiveRotation === null ||
    compareIdentityInstants(snapshot.lastRotatedAt, latestExclusiveRotation) < 0
  );
}

function assertSnapshotChronology(snapshot: IdentitySessionFamilySnapshot): void {
  if (
    compareIdentityInstants(snapshot.createdAt, snapshot.lastRotatedAt) > 0 ||
    compareIdentityInstants(snapshot.lastRotatedAt, snapshot.refreshIdleExpiresAt) >= 0 ||
    compareIdentityInstants(snapshot.refreshIdleExpiresAt, snapshot.refreshAbsoluteExpiresAt) > 0 ||
    (snapshot.revokedAt !== null &&
      compareIdentityInstants(snapshot.revokedAt, snapshot.lastRotatedAt) < 0)
  ) {
    invalidSnapshot();
  }
}

function assertSnapshotLifecycle(snapshot: IdentitySessionFamilySnapshot): void {
  const isRevoked = snapshot.revokedAt !== null;
  const rotationCount = snapshot.version - 1 - (isRevoked ? 1 : 0);

  if (
    isRevoked !== (snapshot.closedReason !== null) ||
    rotationCount < 0 ||
    (snapshot.closedReason === 'REFRESH_REUSE_DETECTED' && rotationCount === 0)
  ) {
    invalidSnapshot();
  }

  if (rotationCount === 0) {
    if (!hasValidInitialIdleLifetime(snapshot)) {
      invalidSnapshot();
    }

    return;
  }

  if (
    !hasValidRotatedIdleLifetime(snapshot) ||
    !hasReachableLastRotation(snapshot, rotationCount)
  ) {
    invalidSnapshot();
  }
}

function parseSnapshot(value: unknown): IdentitySessionFamilySnapshot {
  if (!isRecord(value) || !hasExactSnapshotKeys(value)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    id: parseIdentitySessionId(value['id']),
    accountId: parseIdentityAccountId(value['accountId']),
    version: parseIdentityAggregateVersion(value['version']),
    createdAt: parseIdentityInstant(value['createdAt']),
    lastRotatedAt: parseIdentityInstant(value['lastRotatedAt']),
    refreshIdleExpiresAt: parseIdentityInstant(value['refreshIdleExpiresAt']),
    refreshAbsoluteExpiresAt: parseIdentityInstant(value['refreshAbsoluteExpiresAt']),
    revokedAt: parseNullableIdentityInstant(value['revokedAt']),
    closedReason: parseNullableClosedReason(value['closedReason']),
  });

  assertSnapshotChronology(snapshot);

  if (!hasValidAbsoluteLifetime(snapshot)) {
    invalidSnapshot();
  }

  assertSnapshotLifecycle(snapshot);

  return snapshot;
}

function freezeFacts<Facts extends IdentitySessionFamilyFactTuple>(facts: Facts): Facts {
  return Object.freeze(facts.map((fact) => Object.freeze(fact))) as unknown as Facts;
}

function changed<Facts extends IdentitySessionFamilyFactTuple>(
  sessionFamily: IdentitySessionFamily,
  facts: Facts,
): IdentitySessionFamilyChangedResult<Facts> {
  return Object.freeze({ kind: 'changed', sessionFamily, facts: freezeFacts(facts) });
}

function unchanged(sessionFamily: IdentitySessionFamily): IdentitySessionFamilyUnchangedResult {
  return Object.freeze({
    kind: 'unchanged',
    sessionFamily,
    facts: EMPTY_IDENTITY_SESSION_FAMILY_FACTS,
  });
}

/** Framework-free lifetime and terminal revocation state for one login session. */
export class IdentitySessionFamily {
  readonly #snapshot: IdentitySessionFamilySnapshot;

  private constructor(snapshot: IdentitySessionFamilySnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  public static create(
    input: CreateIdentitySessionFamilyInput,
  ): IdentitySessionFamilyChangedResult<IdentitySessionFamilyCreationFacts> {
    const occurredAt = parseIdentityInstant(input.occurredAt);
    const id = parseIdentitySessionId(input.id);
    const accountId = parseIdentityAccountId(input.accountId);
    const idleLifetime = parseIdentityRefreshIdleLifetimeSeconds(input.refreshIdleLifetimeSeconds);
    const absoluteLifetime = parseIdentityRefreshAbsoluteLifetimeSeconds(
      input.refreshAbsoluteLifetimeSeconds,
    );

    const refreshAbsoluteExpiresAt = IdentitySessionFamily.deadline(occurredAt, absoluteLifetime);
    const refreshIdleExpiresAt = IdentitySessionFamily.deadline(occurredAt, idleLifetime);
    const snapshot = freezeSnapshot({
      id,
      accountId,
      version: parseIdentityAggregateVersion(1),
      createdAt: occurredAt,
      lastRotatedAt: occurredAt,
      refreshIdleExpiresAt,
      refreshAbsoluteExpiresAt,
      revokedAt: null,
      closedReason: null,
    });
    const sessionFamily = new IdentitySessionFamily(snapshot);
    const facts: IdentitySessionFamilyCreationFacts = [
      {
        type: 'SESSION_FAMILY_CREATED',
        sessionId: id,
        accountId,
        state: 'AUTHENTICATING',
        version: snapshot.version,
        occurredAt,
      },
    ];

    return changed(sessionFamily, facts);
  }

  /** Rebuilds authoritative state without replaying historical domain facts. */
  public static rehydrate(value: unknown): IdentitySessionFamily {
    try {
      return new IdentitySessionFamily(parseSnapshot(value));
    } catch {
      throw new InvalidIdentitySessionFamilyStateError();
    }
  }

  public toSnapshot(): IdentitySessionFamilySnapshot {
    return this.#snapshot;
  }

  public authenticationStateAt(
    input: ObserveIdentitySessionFamilyAuthenticationInput,
  ): IdentitySessionFamilyAuthenticationState {
    const observedAt = parseIdentityInstant(input.observedAt);
    const highWaterMark = this.#snapshot.revokedAt ?? this.#snapshot.lastRotatedAt;

    if (compareIdentityInstants(observedAt, highWaterMark) < 0) {
      throw new IdentitySessionFamilyTimestampRegressionError();
    }

    if (this.#snapshot.revokedAt !== null) {
      return 'REVOKED';
    }

    return compareIdentityInstants(observedAt, this.#snapshot.refreshAbsoluteExpiresAt) >= 0
      ? 'ABSOLUTELY_EXPIRED'
      : 'AUTHENTICATING';
  }

  public revoke(
    input: RevokeIdentitySessionFamilyInput,
  ): IdentitySessionFamilyMutationResult<IdentitySessionFamilyGenericRevocationFacts> {
    const closedReason = parseIdentitySessionFamilyGenericRevocationReason(input.closedReason);

    if (this.#snapshot.revokedAt !== null) {
      return unchanged(this);
    }

    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      revokedAt: occurredAt,
      closedReason,
    });
    const sessionFamily = new IdentitySessionFamily(snapshot);
    const facts: IdentitySessionFamilyGenericRevocationFacts = [
      {
        type: 'SESSION_FAMILY_REVOKED',
        sessionId: snapshot.id,
        accountId: snapshot.accountId,
        state: 'REVOKED',
        version: snapshot.version,
        occurredAt,
        closedReason,
      },
    ];

    return changed(sessionFamily, facts);
  }

  private static deadline(
    start: IdentityInstant,
    lifetime: IdentityRefreshIdleLifetimeSeconds | IdentityRefreshAbsoluteLifetimeSeconds,
  ): IdentityInstant {
    const deadline = tryAddIdentitySeconds(start, lifetime);

    if (deadline === null) {
      throw new IdentitySessionFamilyDeadlineOverflowError();
    }

    return deadline;
  }

  private mutationInstant(value: unknown): IdentityInstant {
    const occurredAt = parseIdentityInstant(value);

    if (compareIdentityInstants(occurredAt, this.#snapshot.lastRotatedAt) < 0) {
      throw new IdentitySessionFamilyTimestampRegressionError();
    }

    return occurredAt;
  }
}
