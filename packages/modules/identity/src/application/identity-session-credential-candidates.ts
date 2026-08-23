import {
  IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
  copyIdentityAccessCredentialDigestBytes,
  copyIdentityRefreshCredentialDigestBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from './identity-session-credential-digest.values';
import { InvalidIdentitySessionCredentialCandidatesError } from './identity-session-credential.errors';
import {
  IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX,
  IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX,
  IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH,
  serializeIdentityAccessCredentialWireValue,
  serializeIdentityRefreshCredentialWireValue,
  type IdentityAccessCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from './identity-session-credential-wire.values';

const IDENTITY_SESSION_CREDENTIAL_CANDIDATE_KEYS = Object.freeze(['wireValue', 'digest'] as const);
const IDENTITY_SESSION_CREDENTIAL_CANDIDATES_KEYS = Object.freeze(['access', 'refresh'] as const);

declare const identityAccessCredentialCandidateBrand: unique symbol;
declare const identityRefreshCredentialCandidateBrand: unique symbol;
declare const identitySessionCredentialCandidatesBrand: unique symbol;

export type IdentityAccessCredentialCandidate = Readonly<{
  wireValue: IdentityAccessCredentialWireValue;
  digest: IdentityAccessCredentialDigest;
  readonly [identityAccessCredentialCandidateBrand]: true;
}>;

export type IdentityRefreshCredentialCandidate = Readonly<{
  wireValue: IdentityRefreshCredentialWireValue;
  digest: IdentityRefreshCredentialDigest;
  readonly [identityRefreshCredentialCandidateBrand]: true;
}>;

export type IdentitySessionCredentialCandidates = Readonly<{
  access: IdentityAccessCredentialCandidate;
  refresh: IdentityRefreshCredentialCandidate;
  readonly [identitySessionCredentialCandidatesBrand]: true;
}>;

function invalidCandidates(): never {
  throw new InvalidIdentitySessionCredentialCandidatesError();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);

  return (
    keys.length === expectedKeys.length &&
    keys.every(
      (key) => typeof key === 'string' && expectedKeys.some((expected) => expected === key),
    )
  );
}

function wirePayloadsAreEqual(accessWireValue: string, refreshWireValue: string): boolean {
  let equal = true;

  for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH; index += 1) {
    if (
      accessWireValue.charCodeAt(IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX.length + index) !==
      refreshWireValue.charCodeAt(IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX.length + index)
    ) {
      equal = false;
    }
  }

  return equal;
}

function digestsAreEqual(
  accessDigest: Uint8Array<ArrayBuffer>,
  refreshDigest: Uint8Array<ArrayBuffer>,
): boolean {
  if (
    accessDigest.length !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH ||
    refreshDigest.length !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH
  ) {
    invalidCandidates();
  }

  let equal = true;

  for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
    if (accessDigest[index] !== refreshDigest[index]) {
      equal = false;
    }
  }

  return equal;
}

/**
 * Builds one complete, immutable access/refresh candidate attempt.
 *
 * @internal Identity credential cryptography is the only production caller.
 */
export function createIdentitySessionCredentialCandidates(
  value: unknown,
): IdentitySessionCredentialCandidates {
  try {
    if (!isRecord(value) || !hasExactKeys(value, IDENTITY_SESSION_CREDENTIAL_CANDIDATES_KEYS)) {
      invalidCandidates();
    }

    const accessValue = value['access'];

    if (
      !isRecord(accessValue) ||
      !hasExactKeys(accessValue, IDENTITY_SESSION_CREDENTIAL_CANDIDATE_KEYS)
    ) {
      invalidCandidates();
    }

    const refreshValue = value['refresh'];

    if (
      !isRecord(refreshValue) ||
      !hasExactKeys(refreshValue, IDENTITY_SESSION_CREDENTIAL_CANDIDATE_KEYS)
    ) {
      invalidCandidates();
    }

    const accessWireValue = accessValue['wireValue'] as IdentityAccessCredentialWireValue;
    const serializedAccessWireValue = serializeIdentityAccessCredentialWireValue(accessWireValue);
    const accessDigest = accessValue['digest'] as IdentityAccessCredentialDigest;
    const accessDigestBytes = copyIdentityAccessCredentialDigestBytes(accessDigest);
    const refreshWireValue = refreshValue['wireValue'] as IdentityRefreshCredentialWireValue;
    const serializedRefreshWireValue =
      serializeIdentityRefreshCredentialWireValue(refreshWireValue);
    const refreshDigest = refreshValue['digest'] as IdentityRefreshCredentialDigest;
    const refreshDigestBytes = copyIdentityRefreshCredentialDigestBytes(refreshDigest);

    if (wirePayloadsAreEqual(serializedAccessWireValue, serializedRefreshWireValue)) {
      invalidCandidates();
    }

    if (digestsAreEqual(accessDigestBytes, refreshDigestBytes)) {
      invalidCandidates();
    }

    const access = Object.freeze({
      wireValue: accessWireValue,
      digest: accessDigest,
    }) as unknown as IdentityAccessCredentialCandidate;
    const refresh = Object.freeze({
      wireValue: refreshWireValue,
      digest: refreshDigest,
    }) as unknown as IdentityRefreshCredentialCandidate;

    return Object.freeze({ access, refresh }) as unknown as IdentitySessionCredentialCandidates;
  } catch {
    throw new InvalidIdentitySessionCredentialCandidatesError();
  }
}
