import { isPrismaDatabaseUnavailableError, type PrismaClient } from '@oms/database/prisma';

import {
  IDENTITY_ACCESS_AUTHORITY_REJECTED,
  type IdentityAccessAuthorityReader,
  type IdentityAccessAuthorityResult,
} from '../../application/identity-access-authority.reader';
import {
  IdentityAccessAuthorityPersistenceError,
  IdentityAccessAuthorityUnavailableError,
} from '../../application/identity-access-authority.errors';
import {
  createIdentityAuthenticatedPrincipalFromAuthority,
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT,
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT,
} from '../../application/identity-authenticated-principal';
import { InvalidIdentityAuthenticatedPrincipalError } from '../../application/identity-authenticated-principal.errors';
import {
  copyIdentityAccessCredentialDigestBytes,
  type IdentityAccessCredentialDigest,
} from '../../application/identity-session-credential-digest.values';
import { parseIdentityPermissionCode } from '../../domain/identity-permission.values';
import { parseIdentityRoleId } from '../../domain/identity-role.values';

const AUTHORITY_STATE_CORRUPT = 'CORRUPT';
const AUTHORITY_STATE_REJECTED = 'REJECTED';
const AUTHORITY_STATE_RESOLVED = 'RESOLVED';
const MAX_IDENTITY_ACCESS_AUTHORITY_RAW_MAPPING_ROWS =
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT *
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT;
const IDENTITY_ACCESS_AUTHORITY_OVERFLOW_PROBE_ROW_COUNT =
  MAX_IDENTITY_ACCESS_AUTHORITY_RAW_MAPPING_ROWS + 1;
const IDENTITY_ACCESS_AUTHORITY_ROW_KEYS = Object.freeze([
  'authority_state',
  'actor_id',
  'session_id',
  'assigned_role_id',
  'loaded_role_id',
  'role_status',
  'mapped_permission_code',
  'permission_code',
] as const);

export type IdentityAccessAuthorityPrismaClient = Pick<PrismaClient, '$queryRaw'>;
type UnknownRecord = Readonly<Record<string, unknown>>;

function invalidAuthority(): never {
  throw new InvalidIdentityAuthenticatedPrincipalError();
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactAuthorityRowKeys(value: UnknownRecord): boolean {
  const keys = Reflect.ownKeys(value);

  return (
    keys.length === IDENTITY_ACCESS_AUTHORITY_ROW_KEYS.length &&
    keys.every(
      (key) =>
        typeof key === 'string' &&
        IDENTITY_ACCESS_AUTHORITY_ROW_KEYS.some((expectedKey) => expectedKey === key),
    )
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') {
    invalidAuthority();
  }

  return value;
}

function isNullProjection(value: UnknownRecord): boolean {
  return (
    value['actor_id'] === null &&
    value['session_id'] === null &&
    value['assigned_role_id'] === null &&
    value['loaded_role_id'] === null &&
    value['role_status'] === null &&
    value['mapped_permission_code'] === null &&
    value['permission_code'] === null
  );
}

function compareAscii(left: string, right: string): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function rowsFromRawResult(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    invalidAuthority();
  }

  const rowCount = value.length;

  if (
    !Number.isInteger(rowCount) ||
    rowCount < 0 ||
    rowCount > MAX_IDENTITY_ACCESS_AUTHORITY_RAW_MAPPING_ROWS
  ) {
    invalidAuthority();
  }

  for (let index = 0; index < rowCount; index += 1) {
    if (!Object.hasOwn(value, index)) {
      invalidAuthority();
    }
  }

  return value;
}

function mapIdentityAccessAuthorityResult(value: unknown): IdentityAccessAuthorityResult {
  try {
    const rows = rowsFromRawResult(value);
    const firstUnknownRow = rows[0];

    if (firstUnknownRow === undefined) {
      return IDENTITY_ACCESS_AUTHORITY_REJECTED;
    }

    if (!isRecord(firstUnknownRow) || !hasExactAuthorityRowKeys(firstUnknownRow)) {
      invalidAuthority();
    }

    const authorityState = requiredString(firstUnknownRow['authority_state']);

    if (authorityState === AUTHORITY_STATE_REJECTED) {
      if (rows.length !== 1 || !isNullProjection(firstUnknownRow)) {
        invalidAuthority();
      }

      return IDENTITY_ACCESS_AUTHORITY_REJECTED;
    }

    if (authorityState === AUTHORITY_STATE_CORRUPT) {
      invalidAuthority();
    }

    if (authorityState !== AUTHORITY_STATE_RESOLVED) {
      invalidAuthority();
    }

    const actorId = requiredString(firstUnknownRow['actor_id']);
    const sessionId = requiredString(firstUnknownRow['session_id']);
    const roleIds = new Set<string>();
    const roleStatuses = new Map<string, 'ACTIVE' | 'RETIRED'>();
    const activeRoleProjectionKinds = new Map<string, 'empty' | 'mapped'>();
    const permissionCodes = new Set<string>();
    const rolePermissionPairs = new Set<string>();
    let hasNullRoleProjection = false;

    for (const unknownRow of rows) {
      if (!isRecord(unknownRow) || !hasExactAuthorityRowKeys(unknownRow)) {
        invalidAuthority();
      }

      if (
        unknownRow['authority_state'] !== AUTHORITY_STATE_RESOLVED ||
        unknownRow['actor_id'] !== actorId ||
        unknownRow['session_id'] !== sessionId
      ) {
        invalidAuthority();
      }

      const rawAssignedRoleId = unknownRow['assigned_role_id'];
      const rawLoadedRoleId = unknownRow['loaded_role_id'];
      const rawRoleStatus = unknownRow['role_status'];
      const rawMappedPermissionCode = unknownRow['mapped_permission_code'];
      const rawPermissionCode = unknownRow['permission_code'];

      if (rawAssignedRoleId === null) {
        if (
          rawLoadedRoleId !== null ||
          rawRoleStatus !== null ||
          rawMappedPermissionCode !== null ||
          rawPermissionCode !== null ||
          rows.length !== 1
        ) {
          invalidAuthority();
        }

        hasNullRoleProjection = true;
        continue;
      }

      if (hasNullRoleProjection) {
        invalidAuthority();
      }

      const roleId = parseIdentityRoleId(rawAssignedRoleId);

      if (rawLoadedRoleId !== roleId) {
        invalidAuthority();
      }

      if (rawRoleStatus !== 'ACTIVE' && rawRoleStatus !== 'RETIRED') {
        invalidAuthority();
      }

      const previousRoleStatus = roleStatuses.get(roleId);

      if (previousRoleStatus !== undefined && previousRoleStatus !== rawRoleStatus) {
        invalidAuthority();
      }

      if (rawRoleStatus === 'RETIRED') {
        if (
          previousRoleStatus !== undefined ||
          rawMappedPermissionCode !== null ||
          rawPermissionCode !== null
        ) {
          invalidAuthority();
        }

        roleStatuses.set(roleId, rawRoleStatus);
        continue;
      }

      roleStatuses.set(roleId, rawRoleStatus);

      roleIds.add(roleId);

      if (roleIds.size > MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT) {
        invalidAuthority();
      }

      if (rawMappedPermissionCode === null) {
        if (rawPermissionCode !== null || activeRoleProjectionKinds.has(roleId)) {
          invalidAuthority();
        }

        activeRoleProjectionKinds.set(roleId, 'empty');
        const emptyRolePair = `${roleId}\u0000`;

        if (rolePermissionPairs.has(emptyRolePair)) {
          invalidAuthority();
        }

        rolePermissionPairs.add(emptyRolePair);
        continue;
      }

      const mappedPermissionCode = parseIdentityPermissionCode(rawMappedPermissionCode);

      if (activeRoleProjectionKinds.get(roleId) === 'empty') {
        invalidAuthority();
      }

      activeRoleProjectionKinds.set(roleId, 'mapped');

      if (rawPermissionCode !== mappedPermissionCode) {
        invalidAuthority();
      }

      const permissionCode = parseIdentityPermissionCode(rawPermissionCode);
      const pair = `${roleId}\u0000${permissionCode}`;

      if (rolePermissionPairs.has(pair)) {
        invalidAuthority();
      }

      rolePermissionPairs.add(pair);
      permissionCodes.add(permissionCode);

      if (permissionCodes.size > MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT) {
        invalidAuthority();
      }
    }

    const permissions = [...permissionCodes].sort(compareAscii);
    const principal = createIdentityAuthenticatedPrincipalFromAuthority({
      actorId,
      sessionId,
      activeRoleCount: roleIds.size,
      permissions,
    });

    return Object.freeze({
      kind: 'resolved' as const,
      principal,
    });
  } catch {
    invalidAuthority();
  }
}

function translateQueryError(error: unknown): never {
  if (isPrismaDatabaseUnavailableError(error)) {
    throw new IdentityAccessAuthorityUnavailableError();
  }

  throw new IdentityAccessAuthorityPersistenceError();
}

/**
 * Writer-MySQL implementation of the current Identity access-authority port.
 *
 * One statement owns the database timestamp, credential/session/account gates,
 * issuance-integrity classification, and bounded current-permission projection.
 */
export class PrismaIdentityAccessAuthorityReader implements IdentityAccessAuthorityReader {
  public constructor(private readonly client: IdentityAccessAuthorityPrismaClient) {}

  public async resolveByAccessCredentialDigest(
    accessCredentialDigest: IdentityAccessCredentialDigest,
  ): Promise<IdentityAccessAuthorityResult> {
    const digestBytes = copyIdentityAccessCredentialDigestBytes(accessCredentialDigest);
    let rawResult: unknown;

    try {
      rawResult = await this.client.$queryRaw`
        WITH authority_clock AS (
          SELECT CURRENT_TIMESTAMP(6) AS db_now
        ),
        credential_evidence AS (
          SELECT
            access.family_id,
            family.account_id,
            CASE
              WHEN refresh.id IS NULL
                OR family.id IS NULL
                OR account.id IS NULL
                THEN ${AUTHORITY_STATE_CORRUPT}
              WHEN refresh.issued_at <> access.issued_at
                OR access.expires_at > family.absolute_expires_at
                OR family.created_at > access.issued_at
                OR access.issued_at > family.last_rotated_at
                OR TIMESTAMPDIFF(
                  MICROSECOND,
                  access.issued_at,
                  access.expires_at
                ) NOT BETWEEN 1000000 AND 1800000000
                OR (
                  access.expires_at <> family.absolute_expires_at
                  AND (
                    TIMESTAMPDIFF(
                      MICROSECOND,
                      access.issued_at,
                      access.expires_at
                    ) NOT BETWEEN 300000000 AND 1800000000
                    OR MOD(
                      TIMESTAMPDIFF(
                        MICROSECOND,
                        access.issued_at,
                        access.expires_at
                      ),
                      1000000
                    ) <> 0
                  )
                )
                OR (
                  family.revoked_at IS NULL
                  AND access.sequence > family.version
                )
                THEN ${AUTHORITY_STATE_CORRUPT}
              WHEN family.revoked_at IS NOT NULL
                OR BINARY account.status <> BINARY ${'ACTIVE'}
                OR authority_clock.db_now >= family.absolute_expires_at
                OR authority_clock.db_now < access.issued_at
                OR authority_clock.db_now >= access.expires_at
                THEN ${AUTHORITY_STATE_REJECTED}
              ELSE ${AUTHORITY_STATE_RESOLVED}
            END AS authority_state
          FROM identity_access_credentials AS access
          CROSS JOIN authority_clock
          LEFT JOIN identity_refresh_credentials AS refresh
            ON refresh.family_id = access.family_id
            AND refresh.sequence = access.sequence
          LEFT JOIN identity_session_families AS family
            ON family.id = access.family_id
          LEFT JOIN identity_accounts AS account
            ON account.id = family.account_id
          WHERE access.digest = ${digestBytes}
        )
        SELECT
          evidence.authority_state,
          IF(
            BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED},
            LOWER(BIN_TO_UUID(evidence.account_id, 0)),
            NULL
          ) AS actor_id,
          IF(
            BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED},
            LOWER(BIN_TO_UUID(evidence.family_id, 0)),
            NULL
          ) AS session_id,
          IF(
            BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED},
            LOWER(BIN_TO_UUID(assignment.role_id, 0)),
            NULL
          ) AS assigned_role_id,
          IF(
            BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED},
            LOWER(BIN_TO_UUID(role.id, 0)),
            NULL
          ) AS loaded_role_id,
          IF(
            BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED},
            role.status,
            NULL
          ) AS role_status,
          IF(
            BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED},
            role_permission.permission_code,
            NULL
          ) AS mapped_permission_code,
          IF(
            BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED},
            permission.code,
            NULL
          ) AS permission_code
        FROM credential_evidence AS evidence
        LEFT JOIN identity_account_roles AS assignment
          ON BINARY evidence.authority_state = BINARY ${AUTHORITY_STATE_RESOLVED}
          AND assignment.account_id = evidence.account_id
        LEFT JOIN identity_roles AS role
          ON role.id = assignment.role_id
        LEFT JOIN identity_role_permissions AS role_permission
          ON role_permission.role_id = role.id
          AND BINARY role.status = BINARY ${'ACTIVE'}
        LEFT JOIN identity_permissions AS permission
          ON permission.code = role_permission.permission_code
        LIMIT ${IDENTITY_ACCESS_AUTHORITY_OVERFLOW_PROBE_ROW_COUNT}
      `;
    } catch (error: unknown) {
      return translateQueryError(error);
    } finally {
      digestBytes.fill(0);
    }

    return mapIdentityAccessAuthorityResult(rawResult);
  }
}
