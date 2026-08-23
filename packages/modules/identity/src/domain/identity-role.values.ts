const IDENTITY_ROLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTITY_ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;
const IDENTITY_ROLE_DISPLAY_NAME_OTHER_PATTERN = /\p{C}/u;
const IDENTITY_ROLE_DISPLAY_NAME_WHITESPACE_PATTERN = /\p{White_Space}/u;
const IDENTITY_ROLE_DISPLAY_NAME_NON_CANONICAL_SPACE_PATTERN = /^ | {2}| $/u;

declare const identityRoleIdBrand: unique symbol;
declare const identityRoleCodeBrand: unique symbol;
declare const identityRoleDisplayNameBrand: unique symbol;

export type IdentityRoleId = string & {
  readonly [identityRoleIdBrand]: true;
};

export type IdentityRoleCode = string & {
  readonly [identityRoleCodeBrand]: true;
};

export type IdentityRoleDisplayName = string & {
  readonly [identityRoleDisplayNameBrand]: true;
};

export const MIN_IDENTITY_ROLE_CODE_LENGTH = 3;
export const MAX_IDENTITY_ROLE_CODE_LENGTH = 64;
export const MAX_IDENTITY_ROLE_DISPLAY_NAME_CODE_POINTS = 100;

export const IDENTITY_ROLE_STATUSES = Object.freeze(['ACTIVE', 'RETIRED'] as const);

export type IdentityRoleStatus = (typeof IDENTITY_ROLE_STATUSES)[number];

export class InvalidIdentityRoleIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Identity Role identifier');
    this.name = 'InvalidIdentityRoleIdError';
  }
}

export class InvalidIdentityRoleCodeError extends Error {
  public constructor() {
    super('Expected a canonical Identity Role code');
    this.name = 'InvalidIdentityRoleCodeError';
  }
}

export class InvalidIdentityRoleDisplayNameError extends Error {
  public constructor() {
    super('Expected a valid NFC-normalized Identity Role display name');
    this.name = 'InvalidIdentityRoleDisplayNameError';
  }
}

export class InvalidIdentityRoleStatusError extends Error {
  public constructor() {
    super('Expected a supported Identity Role status');
    this.name = 'InvalidIdentityRoleStatusError';
  }
}

function hasValidDisplayNameScalarLength(value: string): boolean {
  let codePointCount = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      codePoint === undefined ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      ++codePointCount > MAX_IDENTITY_ROLE_DISPLAY_NAME_CODE_POINTS
    ) {
      return false;
    }
  }

  return codePointCount >= 1;
}

function hasOnlyCanonicalDisplayNameWhitespace(value: string): boolean {
  for (const character of value) {
    if (character !== ' ' && IDENTITY_ROLE_DISPLAY_NAME_WHITESPACE_PATTERN.test(character)) {
      return false;
    }
  }

  return true;
}

export function parseIdentityRoleId(value: unknown): IdentityRoleId {
  if (typeof value !== 'string' || !IDENTITY_ROLE_ID_PATTERN.test(value)) {
    throw new InvalidIdentityRoleIdError();
  }

  return value as IdentityRoleId;
}

export function parseIdentityRoleCode(value: unknown): IdentityRoleCode {
  if (
    typeof value !== 'string' ||
    value.length < MIN_IDENTITY_ROLE_CODE_LENGTH ||
    value.length > MAX_IDENTITY_ROLE_CODE_LENGTH ||
    !IDENTITY_ROLE_CODE_PATTERN.test(value)
  ) {
    throw new InvalidIdentityRoleCodeError();
  }

  return value as IdentityRoleCode;
}

/** Rejects invalid display text rather than trimming or normalizing it. */
export function parseIdentityRoleDisplayName(value: unknown): IdentityRoleDisplayName {
  if (
    typeof value !== 'string' ||
    !hasValidDisplayNameScalarLength(value) ||
    value.normalize('NFC') !== value ||
    IDENTITY_ROLE_DISPLAY_NAME_OTHER_PATTERN.test(value) ||
    !hasOnlyCanonicalDisplayNameWhitespace(value) ||
    IDENTITY_ROLE_DISPLAY_NAME_NON_CANONICAL_SPACE_PATTERN.test(value)
  ) {
    throw new InvalidIdentityRoleDisplayNameError();
  }

  return value as IdentityRoleDisplayName;
}

export function parseIdentityRoleStatus(value: unknown): IdentityRoleStatus {
  if (typeof value !== 'string' || !IDENTITY_ROLE_STATUSES.some((status) => status === value)) {
    throw new InvalidIdentityRoleStatusError();
  }

  return value as IdentityRoleStatus;
}
