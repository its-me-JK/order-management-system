const IDENTITY_ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTITY_LOGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;

declare const identityAccountIdBrand: unique symbol;
declare const identityLoginNameBrand: unique symbol;

export type IdentityAccountId = string & {
  readonly [identityAccountIdBrand]: true;
};

export type IdentityLoginName = string & {
  readonly [identityLoginNameBrand]: true;
};

export const IDENTITY_ACCOUNT_STATUSES = Object.freeze([
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
] as const);

export type IdentityAccountStatus = (typeof IDENTITY_ACCOUNT_STATUSES)[number];

export class InvalidIdentityAccountIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Identity Account identifier');
    this.name = 'InvalidIdentityAccountIdError';
  }
}

export class InvalidIdentityLoginNameError extends Error {
  public constructor() {
    super('Expected a canonical Identity login name');
    this.name = 'InvalidIdentityLoginNameError';
  }
}

export class InvalidIdentityAccountStatusError extends Error {
  public constructor() {
    super('Expected a supported Identity Account status');
    this.name = 'InvalidIdentityAccountStatusError';
  }
}

export function parseIdentityAccountId(value: unknown): IdentityAccountId {
  if (typeof value !== 'string' || !IDENTITY_ACCOUNT_ID_PATTERN.test(value)) {
    throw new InvalidIdentityAccountIdError();
  }

  return value as IdentityAccountId;
}

export function parseIdentityLoginName(value: unknown): IdentityLoginName {
  if (typeof value !== 'string' || !IDENTITY_LOGIN_NAME_PATTERN.test(value)) {
    throw new InvalidIdentityLoginNameError();
  }

  return value as IdentityLoginName;
}

export function parseIdentityAccountStatus(value: unknown): IdentityAccountStatus {
  if (typeof value !== 'string' || !IDENTITY_ACCOUNT_STATUSES.some((status) => status === value)) {
    throw new InvalidIdentityAccountStatusError();
  }

  return value as IdentityAccountStatus;
}
