const IDENTITY_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

declare const identitySessionIdBrand: unique symbol;
declare const identityRefreshIdleLifetimeSecondsBrand: unique symbol;
declare const identityRefreshAbsoluteLifetimeSecondsBrand: unique symbol;

export type IdentitySessionId = string & {
  readonly [identitySessionIdBrand]: true;
};

export type IdentityRefreshIdleLifetimeSeconds = number & {
  readonly [identityRefreshIdleLifetimeSecondsBrand]: true;
};

export type IdentityRefreshAbsoluteLifetimeSeconds = number & {
  readonly [identityRefreshAbsoluteLifetimeSecondsBrand]: true;
};

export const MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS = 900;
export const MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS = 86_400;
export const MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS = 86_400;
export const MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS = 2_592_000;

export const IDENTITY_SESSION_FAMILY_AUTHENTICATION_STATES = Object.freeze([
  'AUTHENTICATING',
  'ABSOLUTELY_EXPIRED',
  'REVOKED',
] as const);

export type IdentitySessionFamilyAuthenticationState =
  (typeof IDENTITY_SESSION_FAMILY_AUTHENTICATION_STATES)[number];

export const IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS = Object.freeze([
  'LOGOUT',
  'SESSION_LIMIT_REACHED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'PASSWORD_REPLACED',
  'PASSWORD_REBOUND',
] as const);

export type IdentitySessionFamilyGenericRevocationReason =
  (typeof IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS)[number];

export const IDENTITY_SESSION_FAMILY_CLOSED_REASONS = Object.freeze([
  ...IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS,
  'REFRESH_REUSE_DETECTED',
] as const);

export type IdentitySessionFamilyClosedReason =
  (typeof IDENTITY_SESSION_FAMILY_CLOSED_REASONS)[number];

export class InvalidIdentitySessionIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Identity Session identifier');
    this.name = 'InvalidIdentitySessionIdError';
  }
}

export class InvalidIdentityRefreshIdleLifetimeSecondsError extends Error {
  public constructor() {
    super('Expected a supported Identity refresh idle lifetime in whole seconds');
    this.name = 'InvalidIdentityRefreshIdleLifetimeSecondsError';
  }
}

export class InvalidIdentityRefreshAbsoluteLifetimeSecondsError extends Error {
  public constructor() {
    super('Expected a supported Identity refresh absolute lifetime in whole seconds');
    this.name = 'InvalidIdentityRefreshAbsoluteLifetimeSecondsError';
  }
}

export class InvalidIdentitySessionFamilyClosedReasonError extends Error {
  public constructor() {
    super('Expected a supported Identity Session Family closed reason');
    this.name = 'InvalidIdentitySessionFamilyClosedReasonError';
  }
}

export class InvalidIdentitySessionFamilyGenericRevocationReasonError extends Error {
  public constructor() {
    super('Expected a supported generic Identity Session Family revocation reason');
    this.name = 'InvalidIdentitySessionFamilyGenericRevocationReasonError';
  }
}

export function parseIdentitySessionId(value: unknown): IdentitySessionId {
  if (typeof value !== 'string' || !IDENTITY_SESSION_ID_PATTERN.test(value)) {
    throw new InvalidIdentitySessionIdError();
  }

  return value as IdentitySessionId;
}

export function parseIdentityRefreshIdleLifetimeSeconds(
  value: unknown,
): IdentityRefreshIdleLifetimeSeconds {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS ||
    value > MAX_IDENTITY_REFRESH_IDLE_LIFETIME_SECONDS
  ) {
    throw new InvalidIdentityRefreshIdleLifetimeSecondsError();
  }

  return value as IdentityRefreshIdleLifetimeSeconds;
}

export function parseIdentityRefreshAbsoluteLifetimeSeconds(
  value: unknown,
): IdentityRefreshAbsoluteLifetimeSeconds {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS ||
    value > MAX_IDENTITY_REFRESH_ABSOLUTE_LIFETIME_SECONDS
  ) {
    throw new InvalidIdentityRefreshAbsoluteLifetimeSecondsError();
  }

  return value as IdentityRefreshAbsoluteLifetimeSeconds;
}

export function parseIdentitySessionFamilyClosedReason(
  value: unknown,
): IdentitySessionFamilyClosedReason {
  if (
    typeof value !== 'string' ||
    !IDENTITY_SESSION_FAMILY_CLOSED_REASONS.some((reason) => reason === value)
  ) {
    throw new InvalidIdentitySessionFamilyClosedReasonError();
  }

  return value as IdentitySessionFamilyClosedReason;
}

export function parseIdentitySessionFamilyGenericRevocationReason(
  value: unknown,
): IdentitySessionFamilyGenericRevocationReason {
  if (
    typeof value !== 'string' ||
    !IDENTITY_SESSION_FAMILY_GENERIC_REVOCATION_REASONS.some((reason) => reason === value)
  ) {
    throw new InvalidIdentitySessionFamilyGenericRevocationReasonError();
  }

  return value as IdentitySessionFamilyGenericRevocationReason;
}
