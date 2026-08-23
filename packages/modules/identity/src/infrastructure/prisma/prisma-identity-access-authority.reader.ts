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
import {
  copyIdentityAccessCredentialDigestBytes,
  type IdentityAccessCredentialDigest,
} from '../../application/identity-session-credential-digest.values';
import { mapIdentityAuthorityProjectionRows } from '../identity-authority-projection.mapper';

const AUTHORITY_STATE_CORRUPT = 'CORRUPT';
const AUTHORITY_STATE_REJECTED = 'REJECTED';
const AUTHORITY_STATE_RESOLVED = 'RESOLVED';
const MAX_IDENTITY_ACCESS_AUTHORITY_RAW_MAPPING_ROWS =
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT *
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT;
const IDENTITY_ACCESS_AUTHORITY_OVERFLOW_PROBE_ROW_COUNT =
  MAX_IDENTITY_ACCESS_AUTHORITY_RAW_MAPPING_ROWS + 1;

export type IdentityAccessAuthorityPrismaClient = Pick<PrismaClient, '$queryRaw'>;

function mapIdentityAccessAuthorityResult(value: unknown): IdentityAccessAuthorityResult {
  const result = mapIdentityAuthorityProjectionRows(value);

  if (result.kind === 'rejected') return IDENTITY_ACCESS_AUTHORITY_REJECTED;
  const principal = createIdentityAuthenticatedPrincipalFromAuthority(result.projection);

  return Object.freeze({ kind: 'resolved' as const, principal });
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
