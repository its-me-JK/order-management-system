export const IDENTITY_PASSWORD_AUTHENTICATOR_STATUSES = Object.freeze([
  'ACTIVE',
  'REBIND_REQUIRED',
] as const);

export type IdentityPasswordAuthenticatorStatus =
  (typeof IDENTITY_PASSWORD_AUTHENTICATOR_STATUSES)[number];

declare const identityConsecutiveFailureCountBrand: unique symbol;

/** A persisted consecutive password-verification failure count. */
export type IdentityConsecutiveFailureCount = number & {
  readonly [identityConsecutiveFailureCountBrand]: true;
};

export const MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT = 100;

export class InvalidIdentityPasswordAuthenticatorStatusError extends Error {
  public constructor() {
    super('Expected a supported Identity Password Authenticator status');
    this.name = 'InvalidIdentityPasswordAuthenticatorStatusError';
  }
}

export class InvalidIdentityConsecutiveFailureCountError extends Error {
  public constructor() {
    super('Expected a supported Identity consecutive failure count');
    this.name = 'InvalidIdentityConsecutiveFailureCountError';
  }
}

export function parseIdentityPasswordAuthenticatorStatus(
  value: unknown,
): IdentityPasswordAuthenticatorStatus {
  if (
    typeof value !== 'string' ||
    !IDENTITY_PASSWORD_AUTHENTICATOR_STATUSES.some((status) => status === value)
  ) {
    throw new InvalidIdentityPasswordAuthenticatorStatusError();
  }

  return value as IdentityPasswordAuthenticatorStatus;
}

export function parseIdentityConsecutiveFailureCount(
  value: unknown,
): IdentityConsecutiveFailureCount {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_IDENTITY_CONSECUTIVE_FAILURE_COUNT
  ) {
    throw new InvalidIdentityConsecutiveFailureCountError();
  }

  return value as IdentityConsecutiveFailureCount;
}
