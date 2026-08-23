import { isProxy } from 'node:util/types';

import {
  defineMySqlTransactionStatement,
  type MySqlTransactionStatement,
} from '@oms/database/mysql-transaction';

import type { IdentitySessionRefreshMySqlTransactionFailure } from './identity-session-refresh-mysql.contract';

const OK_PACKET_KEYS = Object.freeze(['affectedRows', 'insertId', 'warningStatus'] as const);
const OK_PACKET_PROTOTYPE_KEYS = Object.freeze(['constructor'] as const);
const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsProxy = isProxy;
const capturedOwnKeys = Reflect.ownKeys;

export type IdentitySessionRefreshReuseDetectedMySqlWriteResult =
  Readonly<{ kind: 'changed' }> | Readonly<{ kind: 'no-match' }> | Readonly<{ kind: 'malformed' }>;

const CHANGED: IdentitySessionRefreshReuseDetectedMySqlWriteResult = capturedFreeze({
  kind: 'changed',
});
const NO_MATCH: IdentitySessionRefreshReuseDetectedMySqlWriteResult = capturedFreeze({
  kind: 'no-match',
});
const MALFORMED: IdentitySessionRefreshReuseDetectedMySqlWriteResult = capturedFreeze({
  kind: 'malformed',
});

function hasExactKeys(actual: readonly PropertyKey[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;

  // Indexing avoids granting mutable Array iterator authority in this decoder boundary.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
    const actualKey = actual[actualIndex];

    if (typeof actualKey !== 'string') return false;
    let matched = false;

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
      if (actualKey === expected[expectedIndex]) {
        matched = true;
        break;
      }
    }

    if (!matched) return false;
  }

  return true;
}

function isExpectedDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
  enumerable: boolean,
): descriptor is PropertyDescriptor & Readonly<{ value: unknown }> {
  return (
    descriptor !== undefined &&
    capturedHasOwn(descriptor, 'value') &&
    descriptor.writable === true &&
    descriptor.enumerable === enumerable &&
    descriptor.configurable === true
  );
}

function isMariaDbOkPacketPrototype(value: object): boolean {
  const prototype: unknown = capturedGetPrototypeOf(value);

  if (
    capturedIsProxy(prototype) ||
    typeof prototype !== 'object' ||
    prototype === null ||
    prototype === objectPrototype ||
    capturedGetPrototypeOf(prototype) !== objectPrototype ||
    !hasExactKeys(capturedOwnKeys(prototype), OK_PACKET_PROTOTYPE_KEYS)
  ) {
    return false;
  }

  const constructorDescriptor = capturedGetOwnPropertyDescriptor(prototype, 'constructor');

  return (
    isExpectedDataDescriptor(constructorDescriptor, false) &&
    typeof constructorDescriptor.value === 'function' &&
    !capturedIsProxy(constructorDescriptor.value)
  );
}

function decodeWriteResult(
  value: unknown,
  acceptNoMatch: boolean,
): IdentitySessionRefreshReuseDetectedMySqlWriteResult {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      !isMariaDbOkPacketPrototype(value) ||
      !hasExactKeys(capturedOwnKeys(value), OK_PACKET_KEYS)
    ) {
      return MALFORMED;
    }

    const affectedRowsDescriptor = capturedGetOwnPropertyDescriptor(value, 'affectedRows');
    const insertIdDescriptor = capturedGetOwnPropertyDescriptor(value, 'insertId');
    const warningStatusDescriptor = capturedGetOwnPropertyDescriptor(value, 'warningStatus');

    if (
      !isExpectedDataDescriptor(affectedRowsDescriptor, true) ||
      !isExpectedDataDescriptor(insertIdDescriptor, true) ||
      !isExpectedDataDescriptor(warningStatusDescriptor, true) ||
      insertIdDescriptor.value !== 0n ||
      warningStatusDescriptor.value !== 0
    ) {
      return MALFORMED;
    }

    if (affectedRowsDescriptor.value === 1) return CHANGED;
    return acceptNoMatch && affectedRowsDescriptor.value === 0 ? NO_MATCH : MALFORMED;
  } catch {
    return MALFORMED;
  }
}

/** @internal Total decoder seam for the conditional reuse-family update. */
export function decodeIdentitySessionRefreshReuseDetectedFamilyMySqlWriteResult(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshReuseDetectedMySqlWriteResult {
  return decodeWriteResult(value, true);
}

/** @internal Total decoder seam for the reuse security-event insert. */
export function decodeIdentitySessionRefreshReuseDetectedSecurityEventMySqlWriteResult(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshReuseDetectedMySqlWriteResult {
  return decodeWriteResult(value, false);
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
