import { InvalidIdentityRefreshCredentialStateError } from './identity-refresh-credential.errors';
import {
  MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE,
  parseIdentityRefreshCredentialId,
  parseIdentityRefreshCredentialSequence,
  type IdentityRefreshCredentialId,
  type IdentityRefreshCredentialSequence,
} from './identity-refresh-credential.values';
import {
  MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
  MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
  parseIdentitySessionId,
  type IdentitySessionId,
} from './identity-session-family.values';
import {
  compareIdentityInstants,
  parseIdentityInstant,
  tryAddIdentitySeconds,
  type IdentityInstant,
} from './identity-values';

const IDENTITY_REFRESH_CREDENTIAL_SNAPSHOT_KEYS = Object.freeze([
  'id',
  'sessionId',
  'sequence',
  'issuedAt',
  'expiresAt',
  'consumedAt',
  'successorId',
] as const);

export type IdentityRefreshCredentialSnapshot = Readonly<{
  id: IdentityRefreshCredentialId;
  sessionId: IdentitySessionId;
  sequence: IdentityRefreshCredentialSequence;
  issuedAt: IdentityInstant;
  expiresAt: IdentityInstant;
  consumedAt: IdentityInstant | null;
  successorId: IdentityRefreshCredentialId | null;
}>;

type CreateInitialIdentityRefreshCredentialInput = Readonly<{
  id: IdentityRefreshCredentialId;
  sessionId: IdentitySessionId;
  issuedAt: IdentityInstant;
  expiresAt: IdentityInstant;
}>;

type RotateIdentityRefreshCredentialInput = Readonly<{
  consumedAt: IdentityInstant;
  successorId: IdentityRefreshCredentialId;
  successorExpiresAt: IdentityInstant;
}>;

export type RotatedIdentityRefreshCredentials = Readonly<{
  consumedRefreshCredential: IdentityRefreshCredential;
  successorRefreshCredential: IdentityRefreshCredential;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactSnapshotKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === IDENTITY_REFRESH_CREDENTIAL_SNAPSHOT_KEYS.length &&
    keys.every((key) =>
      IDENTITY_REFRESH_CREDENTIAL_SNAPSHOT_KEYS.some((expected) => expected === key),
    )
  );
}

function parseNullableIdentityInstant(value: unknown): IdentityInstant | null {
  return value === null ? null : parseIdentityInstant(value);
}

function parseNullableIdentityRefreshCredentialId(
  value: unknown,
): IdentityRefreshCredentialId | null {
  return value === null ? null : parseIdentityRefreshCredentialId(value);
}

function freezeSnapshot(
  snapshot: IdentityRefreshCredentialSnapshot,
): IdentityRefreshCredentialSnapshot {
  return Object.freeze({ ...snapshot });
}

function invalidSnapshot(): never {
  throw new InvalidIdentityRefreshCredentialStateError();
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

function assertSnapshotLifecycle(snapshot: IdentityRefreshCredentialSnapshot): void {
  const isConsumed = snapshot.consumedAt !== null;

  if (isConsumed !== (snapshot.successorId !== null)) {
    invalidSnapshot();
  }

  if (
    !intervalIsAtLeast(snapshot.issuedAt, snapshot.expiresAt, 1) ||
    !intervalIsAtMost(
      snapshot.issuedAt,
      snapshot.expiresAt,
      MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
    )
  ) {
    invalidSnapshot();
  }

  if (
    snapshot.sequence === 1 &&
    (!hasSameFractionalSecond(snapshot.issuedAt, snapshot.expiresAt) ||
      !intervalIsAtLeast(
        snapshot.issuedAt,
        snapshot.expiresAt,
        MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS,
      ))
  ) {
    invalidSnapshot();
  }

  if (
    snapshot.consumedAt !== null &&
    (snapshot.sequence === MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE ||
      compareIdentityInstants(snapshot.consumedAt, snapshot.issuedAt) < 0 ||
      compareIdentityInstants(snapshot.consumedAt, snapshot.expiresAt) >= 0 ||
      snapshot.successorId === snapshot.id)
  ) {
    invalidSnapshot();
  }
}

function parseSnapshot(value: unknown): IdentityRefreshCredentialSnapshot {
  if (!isRecord(value) || !hasExactSnapshotKeys(value)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    id: parseIdentityRefreshCredentialId(value['id']),
    sessionId: parseIdentitySessionId(value['sessionId']),
    sequence: parseIdentityRefreshCredentialSequence(value['sequence']),
    issuedAt: parseIdentityInstant(value['issuedAt']),
    expiresAt: parseIdentityInstant(value['expiresAt']),
    consumedAt: parseNullableIdentityInstant(value['consumedAt']),
    successorId: parseNullableIdentityRefreshCredentialId(value['successorId']),
  });

  assertSnapshotLifecycle(snapshot);

  return snapshot;
}

/** Versionless refresh child. SessionFamily exclusively owns its lifecycle transitions. */
export class IdentityRefreshCredential {
  readonly #snapshot: IdentityRefreshCredentialSnapshot;

  private constructor(snapshot: IdentityRefreshCredentialSnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  /** @internal SessionFamily creation is the only production caller. */
  public static createInitialForSessionFamily(
    input: CreateInitialIdentityRefreshCredentialInput,
  ): IdentityRefreshCredential {
    return new IdentityRefreshCredential(
      parseSnapshot({
        ...input,
        sequence: 1,
        consumedAt: null,
        successorId: null,
      }),
    );
  }

  /** @internal SessionFamily presentation is the only production caller. */
  public static rotateForSessionFamily(
    presented: unknown,
    input: RotateIdentityRefreshCredentialInput,
  ): RotatedIdentityRefreshCredentials {
    let current: IdentityRefreshCredentialSnapshot;

    try {
      current = (presented as IdentityRefreshCredential).#snapshot;
    } catch {
      invalidSnapshot();
    }

    if (current.consumedAt !== null) {
      invalidSnapshot();
    }

    const successorSequence = parseIdentityRefreshCredentialSequence(current.sequence + 1);
    const consumedRefreshCredential = new IdentityRefreshCredential(
      parseSnapshot({
        ...current,
        consumedAt: input.consumedAt,
        successorId: input.successorId,
      }),
    );
    const successorRefreshCredential = new IdentityRefreshCredential(
      parseSnapshot({
        id: input.successorId,
        sessionId: current.sessionId,
        sequence: successorSequence,
        issuedAt: input.consumedAt,
        expiresAt: input.successorExpiresAt,
        consumedAt: null,
        successorId: null,
      }),
    );

    return Object.freeze({ consumedRefreshCredential, successorRefreshCredential });
  }

  /** Rebuilds authoritative child state without loading its token digest or family history. */
  public static rehydrate(value: unknown): IdentityRefreshCredential {
    try {
      return new IdentityRefreshCredential(parseSnapshot(value));
    } catch {
      throw new InvalidIdentityRefreshCredentialStateError();
    }
  }

  public toSnapshot(): IdentityRefreshCredentialSnapshot {
    return this.#snapshot;
  }
}
