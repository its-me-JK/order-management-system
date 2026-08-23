import { isProxy } from 'node:util/types';

import {
  defineMySqlTransactionStatement,
  type MySqlTransactionStatement,
} from '@oms/database/mysql-transaction';

import type { IdentitySessionRefreshMySqlTransactionFailure } from './identity-session-refresh-mysql.contract';

const ACCOUNT_ROW_KEYS = Object.freeze([
  'account_id',
  'account_login_name',
  'account_status',
  'account_version',
  'account_created_at',
  'account_updated_at',
  'account_suspended_at',
  'account_deactivated_at',
] as const);
const SESSION_FAMILY_ROW_KEYS = Object.freeze([
  'session_id',
  'session_account_id',
  'session_version',
  'session_created_at',
  'session_last_rotated_at',
  'session_idle_expires_at',
  'session_absolute_expires_at',
  'session_revoked_at',
  'session_closed_reason',
] as const);
const REFRESH_CREDENTIAL_ROW_KEYS = Object.freeze([
  'refresh_credential_id',
  'refresh_family_id',
  'refresh_sequence',
  'refresh_issued_at',
  'refresh_expires_at',
  'refresh_consumed_at',
  'refresh_successor_id',
  'refresh_active_slot',
] as const);
const EMPTY_RESULT_KEYS = Object.freeze(['length', 'meta'] as const);
const SINGLE_RESULT_KEYS = Object.freeze(['0', 'length', 'meta'] as const);
const arrayPrototype = Array.prototype;
const objectPrototype = Object.prototype;
const capturedDefineProperty = Object.defineProperty;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsProxy = isProxy;
const capturedOwnKeys = Reflect.ownKeys;

type UnknownRecord = Readonly<Record<string, unknown>>;

export type IdentitySessionRefreshLockedLoadMySqlRowResult =
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'found'; row: UnknownRecord }>
  | Readonly<{ kind: 'malformed' }>;

const MALFORMED_ROWS: IdentitySessionRefreshLockedLoadMySqlRowResult = capturedFreeze({
  kind: 'malformed',
});
const NO_ROWS: IdentitySessionRefreshLockedLoadMySqlRowResult = capturedFreeze({
  kind: 'not-found',
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

function isExpectedArrayDescriptor(
  descriptor: PropertyDescriptor | undefined,
  enumerable: boolean,
  configurable: boolean,
): descriptor is PropertyDescriptor & Readonly<{ value: unknown }> {
  return (
    descriptor !== undefined &&
    capturedHasOwn(descriptor, 'value') &&
    descriptor.writable === true &&
    descriptor.enumerable === enumerable &&
    descriptor.configurable === configurable
  );
}

function copyExactRow(value: unknown, expectedKeys: readonly string[]): UnknownRecord | undefined {
  if (
    capturedIsProxy(value) ||
    typeof value !== 'object' ||
    value === null ||
    capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== objectPrototype
  ) {
    return undefined;
  }

  const keys = capturedOwnKeys(value);

  if (!hasExactKeys(keys, expectedKeys)) return undefined;
  const copy: Record<string, unknown> = {};

  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];

    if (key === undefined) return undefined;
    const descriptor = capturedGetOwnPropertyDescriptor(value, key);

    if (!isExpectedArrayDescriptor(descriptor, true, true)) return undefined;
    capturedDefineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }

  return capturedFreeze(copy);
}

function decodeExactRows(
  value: unknown,
  expectedRowKeys: readonly string[],
): IdentitySessionRefreshLockedLoadMySqlRowResult {
  try {
    if (
      capturedIsProxy(value) ||
      !capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== arrayPrototype
    ) {
      return MALFORMED_ROWS;
    }

    const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');
    const metaDescriptor = capturedGetOwnPropertyDescriptor(value, 'meta');

    if (
      !isExpectedArrayDescriptor(lengthDescriptor, false, false) ||
      !isExpectedArrayDescriptor(metaDescriptor, false, false)
    ) {
      return MALFORMED_ROWS;
    }

    const rowCount: unknown = (lengthDescriptor as Readonly<{ value: unknown }>).value;
    const keys = capturedOwnKeys(value);

    if (rowCount === 0) {
      return hasExactKeys(keys, EMPTY_RESULT_KEYS) ? NO_ROWS : MALFORMED_ROWS;
    }

    if (rowCount !== 1 || !hasExactKeys(keys, SINGLE_RESULT_KEYS)) {
      return MALFORMED_ROWS;
    }

    const rowDescriptor = capturedGetOwnPropertyDescriptor(value, '0');

    if (!isExpectedArrayDescriptor(rowDescriptor, true, true)) return MALFORMED_ROWS;
    const row = copyExactRow(rowDescriptor.value, expectedRowKeys);

    return row === undefined ? MALFORMED_ROWS : capturedFreeze({ kind: 'found', row });
  } catch {
    // Statement decoders must be total. Mapping defects are classified by Identity
    // after executeStatement settles, while thrown decoders mean provider outage.
    return MALFORMED_ROWS;
  }
}

/** @internal Total decoder seam for focused provider-envelope contract tests. */
export function decodeIdentitySessionRefreshLockedAccountMySqlRows(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshLockedLoadMySqlRowResult {
  return decodeExactRows(value, ACCOUNT_ROW_KEYS);
}

/** @internal Total decoder seam for focused provider-envelope contract tests. */
export function decodeIdentitySessionRefreshLockedSessionFamilyMySqlRows(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshLockedLoadMySqlRowResult {
  return decodeExactRows(value, SESSION_FAMILY_ROW_KEYS);
}

/** @internal Total decoder seam for focused provider-envelope contract tests. */
export function decodeIdentitySessionRefreshLockedPresentedCredentialMySqlRows(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshLockedLoadMySqlRowResult {
  return decodeExactRows(value, REFRESH_CREDENTIAL_ROW_KEYS);
}

type LockAccountMySqlStatement = MySqlTransactionStatement<
  readonly [accountId: string],
  IdentitySessionRefreshLockedLoadMySqlRowResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;
type LockSessionFamilyMySqlStatement = MySqlTransactionStatement<
  readonly [sessionId: string, accountId: string],
  IdentitySessionRefreshLockedLoadMySqlRowResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;
type LockPresentedCredentialMySqlStatement = MySqlTransactionStatement<
  readonly [presentedRefreshCredentialId: string, sessionId: string, digest: Uint8Array],
  IdentitySessionRefreshLockedLoadMySqlRowResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

export const IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT: LockAccountMySqlStatement =
  defineMySqlTransactionStatement<
    readonly [accountId: string],
    IdentitySessionRefreshLockedLoadMySqlRowResult,
    IdentitySessionRefreshMySqlTransactionFailure
  >({
    text: `
      SELECT
        LOWER(BIN_TO_UUID(account.id, 0)) AS account_id,
        account.login_name AS account_login_name,
        account.status AS account_status,
        account.version AS account_version,
        DATE_FORMAT(account.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS account_created_at,
        DATE_FORMAT(account.updated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS account_updated_at,
        DATE_FORMAT(account.suspended_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS account_suspended_at,
        DATE_FORMAT(account.deactivated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS account_deactivated_at
      FROM identity_accounts AS account FORCE INDEX (PRIMARY)
      WHERE account.id = UUID_TO_BIN(?, 0)
      LIMIT 2
      FOR UPDATE
    `,
    parameterCount: 1,
    decode: decodeIdentitySessionRefreshLockedAccountMySqlRows,
  });

export const IDENTITY_SESSION_REFRESH_LOCK_SESSION_FAMILY_MYSQL_STATEMENT: LockSessionFamilyMySqlStatement =
  defineMySqlTransactionStatement<
    readonly [sessionId: string, accountId: string],
    IdentitySessionRefreshLockedLoadMySqlRowResult,
    IdentitySessionRefreshMySqlTransactionFailure
  >({
    text: `
      SELECT
        LOWER(BIN_TO_UUID(family.id, 0)) AS session_id,
        LOWER(BIN_TO_UUID(family.account_id, 0)) AS session_account_id,
        family.version AS session_version,
        DATE_FORMAT(family.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS session_created_at,
        DATE_FORMAT(family.last_rotated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS session_last_rotated_at,
        DATE_FORMAT(family.idle_expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS session_idle_expires_at,
        DATE_FORMAT(family.absolute_expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS session_absolute_expires_at,
        DATE_FORMAT(family.revoked_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS session_revoked_at,
        family.closed_reason AS session_closed_reason
      FROM identity_session_families AS family FORCE INDEX (PRIMARY)
      WHERE family.id = UUID_TO_BIN(?, 0)
        AND family.account_id = UUID_TO_BIN(?, 0)
      LIMIT 2
      FOR UPDATE
    `,
    parameterCount: 2,
    decode: decodeIdentitySessionRefreshLockedSessionFamilyMySqlRows,
  });

export const IDENTITY_SESSION_REFRESH_LOCK_PRESENTED_CREDENTIAL_MYSQL_STATEMENT: LockPresentedCredentialMySqlStatement =
  defineMySqlTransactionStatement<
    readonly [presentedRefreshCredentialId: string, sessionId: string, digest: Uint8Array],
    IdentitySessionRefreshLockedLoadMySqlRowResult,
    IdentitySessionRefreshMySqlTransactionFailure
  >({
    text: `
      SELECT
        LOWER(BIN_TO_UUID(refresh.id, 0)) AS refresh_credential_id,
        LOWER(BIN_TO_UUID(refresh.family_id, 0)) AS refresh_family_id,
        refresh.sequence AS refresh_sequence,
        DATE_FORMAT(refresh.issued_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS refresh_issued_at,
        DATE_FORMAT(refresh.expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS refresh_expires_at,
        DATE_FORMAT(refresh.consumed_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS refresh_consumed_at,
        LOWER(BIN_TO_UUID(refresh.successor_id, 0)) AS refresh_successor_id,
        refresh.active_slot AS refresh_active_slot
      FROM identity_refresh_credentials AS refresh FORCE INDEX (PRIMARY)
      WHERE refresh.id = UUID_TO_BIN(?, 0)
        AND refresh.family_id = UUID_TO_BIN(?, 0)
        AND refresh.digest = ?
      LIMIT 2
      FOR UPDATE
    `,
    parameterCount: 3,
    decode: decodeIdentitySessionRefreshLockedPresentedCredentialMySqlRows,
  });

export type IdentitySessionRefreshLockedLoadMySqlStatement =
  | typeof IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT
  | typeof IDENTITY_SESSION_REFRESH_LOCK_SESSION_FAMILY_MYSQL_STATEMENT
  | typeof IDENTITY_SESSION_REFRESH_LOCK_PRESENTED_CREDENTIAL_MYSQL_STATEMENT;

type IdentitySessionRefreshLockedLoadMySqlStatementTuple = readonly [
  LockAccountMySqlStatement,
  LockSessionFamilyMySqlStatement,
  LockPresentedCredentialMySqlStatement,
];

/** Fixed allowlist and global lock order for the direct refresh loader. */
export const IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS: IdentitySessionRefreshLockedLoadMySqlStatementTuple =
  Object.freeze([
    IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_LOCK_SESSION_FAMILY_MYSQL_STATEMENT,
    IDENTITY_SESSION_REFRESH_LOCK_PRESENTED_CREDENTIAL_MYSQL_STATEMENT,
  ]);
