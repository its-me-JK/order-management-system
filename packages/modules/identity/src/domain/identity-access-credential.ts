import { InvalidIdentityAccessCredentialStateError } from './identity-access-credential.errors';
import {
  MAX_IDENTITY_ACCESS_LIFETIME_SECONDS,
  parseIdentityAccessCredentialId,
  type IdentityAccessCredentialId,
} from './identity-access-credential.values';
import {
  parseIdentityRefreshCredentialSequence,
  type IdentityRefreshCredentialSequence,
} from './identity-refresh-credential.values';
import { parseIdentitySessionId, type IdentitySessionId } from './identity-session-family.values';
import {
  compareIdentityInstants,
  parseIdentityInstant,
  tryAddIdentitySeconds,
  type IdentityInstant,
} from './identity-values';

const IDENTITY_ACCESS_CREDENTIAL_SNAPSHOT_KEYS = Object.freeze([
  'id',
  'sessionId',
  'sequence',
  'issuedAt',
  'expiresAt',
] as const);

export type IdentityAccessCredentialSnapshot = Readonly<{
  id: IdentityAccessCredentialId;
  sessionId: IdentitySessionId;
  sequence: IdentityRefreshCredentialSequence;
  issuedAt: IdentityInstant;
  expiresAt: IdentityInstant;
}>;

type IssueIdentityAccessCredentialForSessionFamilyInput = Readonly<{
  id: IdentityAccessCredentialId;
  sessionId: IdentitySessionId;
  sequence: IdentityRefreshCredentialSequence;
  issuedAt: IdentityInstant;
  expiresAt: IdentityInstant;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactSnapshotKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === IDENTITY_ACCESS_CREDENTIAL_SNAPSHOT_KEYS.length &&
    keys.every((key) =>
      IDENTITY_ACCESS_CREDENTIAL_SNAPSHOT_KEYS.some((expected) => expected === key),
    )
  );
}

function freezeSnapshot(
  snapshot: IdentityAccessCredentialSnapshot,
): IdentityAccessCredentialSnapshot {
  return Object.freeze({ ...snapshot });
}

function invalidSnapshot(): never {
  throw new InvalidIdentityAccessCredentialStateError();
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

function parseSnapshot(value: unknown): IdentityAccessCredentialSnapshot {
  if (!isRecord(value) || !hasExactSnapshotKeys(value)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    id: parseIdentityAccessCredentialId(value['id']),
    sessionId: parseIdentitySessionId(value['sessionId']),
    sequence: parseIdentityRefreshCredentialSequence(value['sequence']),
    issuedAt: parseIdentityInstant(value['issuedAt']),
    expiresAt: parseIdentityInstant(value['expiresAt']),
  });

  if (
    !intervalIsAtLeast(snapshot.issuedAt, snapshot.expiresAt, 1) ||
    !intervalIsAtMost(snapshot.issuedAt, snapshot.expiresAt, MAX_IDENTITY_ACCESS_LIFETIME_SECONDS)
  ) {
    invalidSnapshot();
  }

  return snapshot;
}

/** Versionless access child. SessionFamily exclusively owns issuance. */
export class IdentityAccessCredential {
  readonly #snapshot: IdentityAccessCredentialSnapshot;

  private constructor(snapshot: IdentityAccessCredentialSnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  /** @internal SessionFamily creation and refresh presentation are the only production callers. */
  public static issueForSessionFamily(
    input: IssueIdentityAccessCredentialForSessionFamilyInput,
  ): IdentityAccessCredential {
    return new IdentityAccessCredential(parseSnapshot(input));
  }

  /** Rebuilds authoritative child state without loading its token digest or family history. */
  public static rehydrate(value: unknown): IdentityAccessCredential {
    try {
      return new IdentityAccessCredential(parseSnapshot(value));
    } catch {
      throw new InvalidIdentityAccessCredentialStateError();
    }
  }

  public toSnapshot(): IdentityAccessCredentialSnapshot {
    return this.#snapshot;
  }
}
