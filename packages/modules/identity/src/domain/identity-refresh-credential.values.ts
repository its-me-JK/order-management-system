import { MAX_IDENTITY_AGGREGATE_VERSION } from './identity-values';

const IDENTITY_REFRESH_CREDENTIAL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

declare const identityRefreshCredentialIdBrand: unique symbol;
declare const identityRefreshCredentialSequenceBrand: unique symbol;

export type IdentityRefreshCredentialId = string & {
  readonly [identityRefreshCredentialIdBrand]: true;
};

export type IdentityRefreshCredentialSequence = number & {
  readonly [identityRefreshCredentialSequenceBrand]: true;
};

/** The final unsigned family version is reserved for terminal revocation. */
export const MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE = MAX_IDENTITY_AGGREGATE_VERSION - 1;

export class InvalidIdentityRefreshCredentialIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Identity Refresh Credential identifier');
    this.name = 'InvalidIdentityRefreshCredentialIdError';
  }
}

export class InvalidIdentityRefreshCredentialSequenceError extends Error {
  public constructor() {
    super('Expected a supported Identity Refresh Credential sequence');
    this.name = 'InvalidIdentityRefreshCredentialSequenceError';
  }
}

export function parseIdentityRefreshCredentialId(value: unknown): IdentityRefreshCredentialId {
  if (typeof value !== 'string' || !IDENTITY_REFRESH_CREDENTIAL_ID_PATTERN.test(value)) {
    throw new InvalidIdentityRefreshCredentialIdError();
  }

  return value as IdentityRefreshCredentialId;
}

export function parseIdentityRefreshCredentialSequence(
  value: unknown,
): IdentityRefreshCredentialSequence {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE
  ) {
    throw new InvalidIdentityRefreshCredentialSequenceError();
  }

  return value as IdentityRefreshCredentialSequence;
}
