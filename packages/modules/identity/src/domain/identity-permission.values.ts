const IDENTITY_PERMISSION_SEGMENT_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

declare const identityPermissionCodeBrand: unique symbol;

/** A canonical policy identifier; registry existence is an application concern. */
export type IdentityPermissionCode = string & {
  readonly [identityPermissionCodeBrand]: true;
};

export const MAX_IDENTITY_PERMISSION_CODE_LENGTH = 98;
export const MAX_IDENTITY_PERMISSION_SEGMENT_LENGTH = 32;
export const MAX_IDENTITY_ROLE_PERMISSIONS = 128;

export class InvalidIdentityPermissionCodeError extends Error {
  public constructor() {
    super('Expected a canonical Identity permission code');
    this.name = 'InvalidIdentityPermissionCodeError';
  }
}

export function parseIdentityPermissionCode(value: unknown): IdentityPermissionCode {
  if (typeof value !== 'string' || value.length > MAX_IDENTITY_PERMISSION_CODE_LENGTH) {
    throw new InvalidIdentityPermissionCodeError();
  }

  const segments = value.split('.');

  if (
    segments.length !== 3 ||
    segments.some(
      (segment) =>
        segment.length > MAX_IDENTITY_PERMISSION_SEGMENT_LENGTH ||
        !IDENTITY_PERMISSION_SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new InvalidIdentityPermissionCodeError();
  }

  return value as IdentityPermissionCode;
}
