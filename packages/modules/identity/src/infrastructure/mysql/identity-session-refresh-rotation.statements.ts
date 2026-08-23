import {
  defineMySqlTransactionStatement,
  type MySqlTransactionStatement,
} from '@oms/database/mysql-transaction';

import type { IdentitySessionRefreshMySqlTransactionFailure } from './identity-session-refresh-mysql.contract';
import {
  decodeIdentitySessionRefreshConditionalMySqlWriteResult,
  decodeIdentitySessionRefreshInsertMySqlWriteResult,
  type IdentitySessionRefreshMySqlWriteResult,
} from './identity-session-refresh-mysql-write-result';
import {
  IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
  type IdentitySessionRefreshRotationAuthorityMySqlStatement,
} from './identity-session-refresh-rotation-authority.statement';

const capturedFreeze = Object.freeze;

type ConsumePredecessorMySqlStatement = MySqlTransactionStatement<
  readonly [
    consumedAt: string,
    predecessorId: string,
    sessionId: string,
    predecessorSequence: number,
    predecessorIssuedAt: string,
    predecessorExpiresAt: string,
  ],
  IdentitySessionRefreshMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type InsertSuccessorRefreshCredentialMySqlStatement = MySqlTransactionStatement<
  readonly [
    successorId: string,
    sessionId: string,
    successorDigest: Uint8Array,
    successorSequence: number,
    successorIssuedAt: string,
    successorExpiresAt: string,
  ],
  IdentitySessionRefreshMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type InsertAccessCredentialMySqlStatement = MySqlTransactionStatement<
  readonly [
    accessId: string,
    sessionId: string,
    accessDigest: Uint8Array,
    accessSequence: number,
    accessIssuedAt: string,
    accessExpiresAt: string,
  ],
  IdentitySessionRefreshMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type LinkPredecessorMySqlStatement = MySqlTransactionStatement<
  readonly [
    successorId: string,
    predecessorId: string,
    sessionId: string,
    predecessorSequence: number,
    predecessorIssuedAt: string,
    predecessorExpiresAt: string,
    consumedAt: string,
  ],
  IdentitySessionRefreshMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type AdvanceFamilyMySqlStatement = MySqlTransactionStatement<
  readonly [
    resultingFamilyVersion: number,
    resultingLastRotatedAt: string,
    resultingIdleExpiresAt: string,
    sessionId: string,
    accountId: string,
    priorFamilyVersion: number,
    familyCreatedAt: string,
    predecessorIssuedAt: string,
    predecessorExpiresAt: string,
    absoluteExpiresAt: string,
    accountVersion: number,
    predecessorId: string,
    predecessorSequence: number,
    consumedAt: string,
    linkedSuccessorId: string,
    successorId: string,
    successorSequence: number,
    successorIssuedAt: string,
    successorExpiresAt: string,
    accessId: string,
    accessSequence: number,
    accessIssuedAt: string,
    accessExpiresAt: string,
  ],
  IdentitySessionRefreshMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type AppendRotatedEventMySqlStatement = MySqlTransactionStatement<
  readonly [
    securityEventId: string,
    actorAccountId: string,
    subjectAccountId: string,
    sessionId: string,
    occurredAt: string,
  ],
  IdentitySessionRefreshMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

export const IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT: ConsumePredecessorMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      UPDATE identity_refresh_credentials AS predecessor FORCE INDEX (PRIMARY)
      SET
        consumed_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'),
        active_slot = NULL
      WHERE predecessor.id = UUID_TO_BIN(?, 0)
        AND predecessor.family_id = UUID_TO_BIN(?, 0)
        AND predecessor.sequence = ?
        AND predecessor.issued_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND predecessor.expires_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND predecessor.consumed_at IS NULL
        AND predecessor.successor_id IS NULL
        AND predecessor.active_slot = 1
    `,
    parameterCount: 6,
    decode: decodeIdentitySessionRefreshConditionalMySqlWriteResult,
  });

export const IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT: InsertSuccessorRefreshCredentialMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      INSERT INTO identity_refresh_credentials (
        id,
        family_id,
        digest,
        sequence,
        issued_at,
        expires_at,
        consumed_at,
        successor_id,
        active_slot
      ) VALUES (
        UUID_TO_BIN(?, 0),
        UUID_TO_BIN(?, 0),
        ?,
        ?,
        STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'),
        STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'),
        NULL,
        NULL,
        1
      )
    `,
    parameterCount: 6,
    decode: decodeIdentitySessionRefreshInsertMySqlWriteResult,
    duplicateKeyFailures: {
      PRIMARY: 'credential-collision',
      'identity_refresh_credentials.PRIMARY': 'credential-collision',
      uq_identity_refresh_credentials_digest: 'credential-collision',
      'identity_refresh_credentials.uq_identity_refresh_credentials_digest': 'credential-collision',
      uq_identity_refresh_credentials_family_sequence: 'conditional-conflict',
      'identity_refresh_credentials.uq_identity_refresh_credentials_family_sequence':
        'conditional-conflict',
      uq_identity_refresh_credentials_family_active_slot: 'conditional-conflict',
      'identity_refresh_credentials.uq_identity_refresh_credentials_family_active_slot':
        'conditional-conflict',
    },
  });

export const IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT: InsertAccessCredentialMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      INSERT INTO identity_access_credentials (
        id,
        family_id,
        digest,
        sequence,
        issued_at,
        expires_at
      ) VALUES (
        UUID_TO_BIN(?, 0),
        UUID_TO_BIN(?, 0),
        ?,
        ?,
        STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'),
        STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
      )
    `,
    parameterCount: 6,
    decode: decodeIdentitySessionRefreshInsertMySqlWriteResult,
    duplicateKeyFailures: {
      PRIMARY: 'credential-collision',
      'identity_access_credentials.PRIMARY': 'credential-collision',
      uq_identity_access_credentials_digest: 'credential-collision',
      'identity_access_credentials.uq_identity_access_credentials_digest': 'credential-collision',
      uq_identity_access_credentials_family_sequence: 'conditional-conflict',
      'identity_access_credentials.uq_identity_access_credentials_family_sequence':
        'conditional-conflict',
    },
  });

export const IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT: LinkPredecessorMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      UPDATE identity_refresh_credentials AS predecessor FORCE INDEX (PRIMARY)
      SET successor_id = UUID_TO_BIN(?, 0)
      WHERE predecessor.id = UUID_TO_BIN(?, 0)
        AND predecessor.family_id = UUID_TO_BIN(?, 0)
        AND predecessor.sequence = ?
        AND predecessor.issued_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND predecessor.expires_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND predecessor.consumed_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND predecessor.successor_id IS NULL
        AND predecessor.active_slot IS NULL
    `,
    parameterCount: 7,
    decode: decodeIdentitySessionRefreshConditionalMySqlWriteResult,
    duplicateKeyFailures: {
      uq_identity_refresh_credentials_successor: 'conditional-conflict',
      'identity_refresh_credentials.uq_identity_refresh_credentials_successor':
        'conditional-conflict',
    },
  });

export const IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT: AdvanceFamilyMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      UPDATE identity_session_families AS family FORCE INDEX (PRIMARY)
      SET
        version = ?,
        last_rotated_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'),
        idle_expires_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
      WHERE family.id = UUID_TO_BIN(?, 0)
        AND family.account_id = UUID_TO_BIN(?, 0)
        AND family.version = ?
        AND family.created_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND family.last_rotated_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND family.idle_expires_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND family.absolute_expires_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        AND family.revoked_at IS NULL
        AND family.closed_reason IS NULL
        AND EXISTS (
          SELECT 1
          FROM identity_accounts AS account FORCE INDEX (PRIMARY)
          WHERE account.id = family.account_id
            AND account.version = ?
            AND BINARY account.status = BINARY _ascii'ACTIVE'
            AND account.suspended_at IS NULL
            AND account.deactivated_at IS NULL
        )
        AND EXISTS (
          SELECT 1
          FROM identity_refresh_credentials AS predecessor FORCE INDEX (PRIMARY)
          WHERE predecessor.id = UUID_TO_BIN(?, 0)
            AND predecessor.family_id = family.id
            AND predecessor.sequence = ?
            AND predecessor.issued_at = family.last_rotated_at
            AND predecessor.expires_at = family.idle_expires_at
            AND predecessor.consumed_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
            AND predecessor.successor_id = UUID_TO_BIN(?, 0)
            AND predecessor.active_slot IS NULL
        )
        AND EXISTS (
          SELECT 1
          FROM identity_refresh_credentials AS successor FORCE INDEX (PRIMARY)
          WHERE successor.id = UUID_TO_BIN(?, 0)
            AND successor.family_id = family.id
            AND successor.sequence = ?
            AND successor.issued_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
            AND successor.expires_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
            AND successor.consumed_at IS NULL
            AND successor.successor_id IS NULL
            AND successor.active_slot = 1
        )
        AND EXISTS (
          SELECT 1
          FROM identity_access_credentials AS access FORCE INDEX (PRIMARY)
          WHERE access.id = UUID_TO_BIN(?, 0)
            AND access.family_id = family.id
            AND access.sequence = ?
            AND access.issued_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
            AND access.expires_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
        )
    `,
    parameterCount: 23,
    decode: decodeIdentitySessionRefreshConditionalMySqlWriteResult,
  });

export const IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT: AppendRotatedEventMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      INSERT INTO identity_security_events (
        id,
        event_type,
        outcome,
        reason_code,
        actor_account_id,
        subject_account_id,
        role_id,
        session_id,
        permission_code,
        request_id,
        correlation_id,
        operator_reference,
        occurred_at
      ) VALUES (
        UUID_TO_BIN(?, 0),
        _ascii'SESSION_REFRESH',
        _ascii'SUCCEEDED',
        NULL,
        UUID_TO_BIN(?, 0),
        UUID_TO_BIN(?, 0),
        NULL,
        UUID_TO_BIN(?, 0),
        NULL,
        NULL,
        NULL,
        NULL,
        STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ')
      )
    `,
    parameterCount: 5,
    decode: decodeIdentitySessionRefreshInsertMySqlWriteResult,
  });

export type IdentitySessionRefreshRotationMySqlStatement =
  | typeof IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT
  | typeof IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT
  | typeof IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT
  | typeof IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT
  | typeof IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT
  | IdentitySessionRefreshRotationAuthorityMySqlStatement
  | typeof IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT;

type IdentitySessionRefreshRotationMySqlStatementTuple = readonly [
  ConsumePredecessorMySqlStatement,
  InsertSuccessorRefreshCredentialMySqlStatement,
  InsertAccessCredentialMySqlStatement,
  LinkPredecessorMySqlStatement,
  AdvanceFamilyMySqlStatement,
  IdentitySessionRefreshRotationAuthorityMySqlStatement,
  AppendRotatedEventMySqlStatement,
];

/** Fixed mutation, authority-resolution, and evidence order for one successful rotation. */
export const IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS: IdentitySessionRefreshRotationMySqlStatementTuple =
  capturedFreeze([
    IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
  ]);
