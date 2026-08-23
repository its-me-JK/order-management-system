const IDENTITY_ACCESS_CREDENTIAL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

declare const identityAccessCredentialIdBrand: unique symbol;
declare const identityAccessLifetimeSecondsBrand: unique symbol;

export type IdentityAccessCredentialId = string & {
  readonly [identityAccessCredentialIdBrand]: true;
};

export type IdentityAccessLifetimeSeconds = number & {
  readonly [identityAccessLifetimeSecondsBrand]: true;
};

export const MIN_IDENTITY_ACCESS_LIFETIME_SECONDS = 300;
export const MAX_IDENTITY_ACCESS_LIFETIME_SECONDS = 1_800;

export class InvalidIdentityAccessCredentialIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Identity Access Credential identifier');
    this.name = 'InvalidIdentityAccessCredentialIdError';
  }
}

export class InvalidIdentityAccessLifetimeSecondsError extends Error {
  public constructor() {
    super('Expected a supported Identity access lifetime in whole seconds');
    this.name = 'InvalidIdentityAccessLifetimeSecondsError';
  }
}

export function parseIdentityAccessCredentialId(value: unknown): IdentityAccessCredentialId {
  if (typeof value !== 'string' || !IDENTITY_ACCESS_CREDENTIAL_ID_PATTERN.test(value)) {
    throw new InvalidIdentityAccessCredentialIdError();
  }

  return value as IdentityAccessCredentialId;
}

export function parseIdentityAccessLifetimeSeconds(value: unknown): IdentityAccessLifetimeSeconds {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_IDENTITY_ACCESS_LIFETIME_SECONDS ||
    value > MAX_IDENTITY_ACCESS_LIFETIME_SECONDS
  ) {
    throw new InvalidIdentityAccessLifetimeSecondsError();
  }

  return value as IdentityAccessLifetimeSeconds;
}
