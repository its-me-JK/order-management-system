const IDENTITY_SECURITY_EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

declare const identitySecurityEventIdBrand: unique symbol;

/** A canonical UUIDv7 identifier in the SecurityEvent namespace. */
export type IdentitySecurityEventId = string & {
  readonly [identitySecurityEventIdBrand]: true;
};

export class InvalidIdentitySecurityEventIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Identity SecurityEvent identifier');
    this.name = 'InvalidIdentitySecurityEventIdError';
  }
}

export function parseIdentitySecurityEventId(value: unknown): IdentitySecurityEventId {
  if (typeof value !== 'string' || !IDENTITY_SECURITY_EVENT_ID_PATTERN.test(value)) {
    throw new InvalidIdentitySecurityEventIdError();
  }

  return value as IdentitySecurityEventId;
}
