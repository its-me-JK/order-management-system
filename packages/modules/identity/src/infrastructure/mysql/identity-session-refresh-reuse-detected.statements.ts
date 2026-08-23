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

const capturedFreeze = Object.freeze;
const decodeConditionalWriteResult: (value: unknown) => IdentitySessionRefreshMySqlWriteResult =
  decodeIdentitySessionRefreshConditionalMySqlWriteResult;
const decodeInsertWriteResult: (value: unknown) => IdentitySessionRefreshMySqlWriteResult =
  decodeIdentitySessionRefreshInsertMySqlWriteResult;

export type IdentitySessionRefreshReuseDetectedMySqlWriteResult =
  IdentitySessionRefreshMySqlWriteResult;

/** @internal Total decoder seam for the conditional reuse-family update. */
export function decodeIdentitySessionRefreshReuseDetectedFamilyMySqlWriteResult(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshReuseDetectedMySqlWriteResult {
  return decodeConditionalWriteResult(value);
}

/** @internal Total decoder seam for the reuse security-event insert. */
export function decodeIdentitySessionRefreshReuseDetectedSecurityEventMySqlWriteResult(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshReuseDetectedMySqlWriteResult {
  return decodeInsertWriteResult(value);
}

type RevokeReusedFamilyMySqlStatement = MySqlTransactionStatement<
  readonly [
    resultingVersion: number,
    revokedAt: string,
    sessionId: string,
    accountId: string,
    priorSessionFamilyVersion: number,
    accountVersion: number,
    presentedRefreshCredentialId: string,
    presentedRefreshCredentialSequence: number,
  ],
  IdentitySessionRefreshReuseDetectedMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type AppendReuseEventMySqlStatement = MySqlTransactionStatement<
  readonly [
    securityEventId: string,
    subjectAccountId: string,
    sessionId: string,
    occurredAt: string,
  ],
  IdentitySessionRefreshReuseDetectedMySqlWriteResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

export const IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT: RevokeReusedFamilyMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      UPDATE identity_session_families AS family FORCE INDEX (PRIMARY)
      SET
        version = ?,
        revoked_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'),
        closed_reason = _ascii'REFRESH_REUSE_DETECTED'
      WHERE family.id = UUID_TO_BIN(?, 0)
        AND family.account_id = UUID_TO_BIN(?, 0)
        AND family.version = ?
        AND family.revoked_at IS NULL
        AND family.closed_reason IS NULL
        AND EXISTS (
          SELECT 1
          FROM identity_accounts AS account FORCE INDEX (PRIMARY)
          WHERE account.id = family.account_id
            AND account.version = ?
        )
        AND EXISTS (
          SELECT 1
          FROM identity_refresh_credentials AS refresh FORCE INDEX (PRIMARY)
          WHERE refresh.id = UUID_TO_BIN(?, 0)
            AND refresh.family_id = family.id
            AND refresh.sequence = ?
            AND refresh.consumed_at IS NOT NULL
            AND refresh.successor_id IS NOT NULL
            AND refresh.active_slot IS NULL
        )
    `,
    parameterCount: 8,
    decode: decodeIdentitySessionRefreshReuseDetectedFamilyMySqlWriteResult,
  });

export const IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT: AppendReuseEventMySqlStatement =
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
        _ascii'REJECTED',
        _ascii'REFRESH_REUSE_DETECTED',
        NULL,
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
    parameterCount: 4,
    decode: decodeIdentitySessionRefreshReuseDetectedSecurityEventMySqlWriteResult,
  });

export type IdentitySessionRefreshReuseDetectedMySqlStatement =
  | typeof IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT
  | typeof IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT;

type IdentitySessionRefreshReuseDetectedMySqlStatementTuple = readonly [
  RevokeReusedFamilyMySqlStatement,
  AppendReuseEventMySqlStatement,
];

/** Fixed DML order for one refresh-reuse decision. */
export const IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS: IdentitySessionRefreshReuseDetectedMySqlStatementTuple =
  capturedFreeze([
    IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
  ]);
