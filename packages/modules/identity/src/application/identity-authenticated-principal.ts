import { parseIdentityAccountId } from '../domain/identity-account.values';
import {
  MAX_IDENTITY_ROLE_PERMISSIONS,
  parseIdentityPermissionCode,
  type IdentityPermissionCode,
} from '../domain/identity-permission.values';
import { parseIdentitySessionId } from '../domain/identity-session-family.values';
import { InvalidIdentityAuthenticatedPrincipalError } from './identity-authenticated-principal.errors';

const IDENTITY_AUTHENTICATED_PRINCIPAL_AUTHORITY_EVIDENCE_KEYS = Object.freeze([
  'actorId',
  'sessionId',
  'activeRoleCount',
  'permissions',
] as const);

const identityAuthenticatedPrincipals = new WeakSet<object>();

declare const identityAuthenticatedPrincipalBrand: unique symbol;

/** An immutable authority result that only Identity infrastructure may construct. */
export type IdentityAuthenticatedPrincipal = Readonly<{
  actorId: string;
  sessionId: string;
  permissions: readonly string[];
  readonly [identityAuthenticatedPrincipalBrand]: true;
}>;

export const MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT = 16;
export const MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT = MAX_IDENTITY_ROLE_PERMISSIONS;

function invalidPrincipal(): never {
  throw new InvalidIdentityAuthenticatedPrincipalError();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactAuthorityEvidenceKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Reflect.ownKeys(value);

  return (
    keys.length === IDENTITY_AUTHENTICATED_PRINCIPAL_AUTHORITY_EVIDENCE_KEYS.length &&
    keys.every(
      (key) =>
        typeof key === 'string' &&
        IDENTITY_AUTHENTICATED_PRINCIPAL_AUTHORITY_EVIDENCE_KEYS.some(
          (expected) => expected === key,
        ),
    )
  );
}

function parseActiveRoleCount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT
  ) {
    invalidPrincipal();
  }

  return value;
}

function comparePermissionCodes(
  left: IdentityPermissionCode,
  right: IdentityPermissionCode,
): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function parseCanonicalPermissions(
  value: unknown,
  activeRoleCount: number,
): readonly IdentityPermissionCode[] {
  if (!Array.isArray(value)) {
    invalidPrincipal();
  }

  const permissionCount = value.length;

  if (
    !Number.isInteger(permissionCount) ||
    permissionCount < 0 ||
    permissionCount > MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT ||
    (activeRoleCount === 0 && permissionCount !== 0)
  ) {
    invalidPrincipal();
  }

  const permissions: IdentityPermissionCode[] = [];

  for (let index = 0; index < permissionCount; index += 1) {
    if (!Object.hasOwn(value, index)) {
      invalidPrincipal();
    }

    const permission = parseIdentityPermissionCode(value[index]);
    const previous = permissions[index - 1];

    if (previous !== undefined && comparePermissionCodes(previous, permission) >= 0) {
      invalidPrincipal();
    }

    permissions.push(permission);
  }

  if (value.length !== permissionCount) {
    invalidPrincipal();
  }

  return Object.freeze(permissions);
}

/**
 * Constructs a trusted principal from a bounded, already-canonical authority projection.
 *
 * @internal Identity infrastructure is the only production caller.
 */
export function createIdentityAuthenticatedPrincipalFromAuthority(
  value: unknown,
): IdentityAuthenticatedPrincipal {
  try {
    if (!isRecord(value) || !hasExactAuthorityEvidenceKeys(value)) {
      invalidPrincipal();
    }

    const actorId = parseIdentityAccountId(value['actorId']);
    const sessionId = parseIdentitySessionId(value['sessionId']);
    const activeRoleCount = parseActiveRoleCount(value['activeRoleCount']);
    const permissions = parseCanonicalPermissions(value['permissions'], activeRoleCount);

    const principal = Object.freeze({
      actorId,
      sessionId,
      permissions,
    }) as unknown as IdentityAuthenticatedPrincipal;

    identityAuthenticatedPrincipals.add(principal);

    return principal;
  } catch {
    throw new InvalidIdentityAuthenticatedPrincipalError();
  }
}

/** @internal Verifies that the value was produced by the trusted authority factory. */
export function authenticateIdentityAuthenticatedPrincipal(
  value: unknown,
): IdentityAuthenticatedPrincipal {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !identityAuthenticatedPrincipals.has(value)
    ) {
      invalidPrincipal();
    }

    return value as IdentityAuthenticatedPrincipal;
  } catch {
    invalidPrincipal();
  }
}
