import { isProxy } from 'node:util/types';

import {
  defineMySqlTransactionStatement,
  type MySqlTransactionStatement,
} from '@oms/database/mysql-transaction';

import {
  mapIdentityAuthorityProjectionRows,
  type IdentityAuthorityProjection,
} from '../identity-authority-projection.mapper';
import type { IdentitySessionRefreshMySqlTransactionFailure } from './identity-session-refresh-mysql.contract';

const AUTHORITY_ROW_KEYS = Object.freeze([
  'authority_state',
  'actor_id',
  'session_id',
  'assigned_role_id',
  'loaded_role_id',
  'role_status',
  'mapped_permission_code',
  'permission_code',
] as const);
const MAX_MYSQL_AUTHORITY_PROJECTION_ROWS = 2_049;
const arrayPrototype = Array.prototype;
const objectPrototype = Object.prototype;
const capturedDefineProperty = Object.defineProperty;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsInteger = Number.isInteger;
const capturedIsProxy = isProxy;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const mapAuthorityProjectionRows = mapIdentityAuthorityProjectionRows;

type UnknownRecord = Readonly<Record<string, unknown>>;

export type IdentitySessionRefreshRotationAuthorityMySqlResult =
  | Readonly<{ kind: 'resolved'; projection: IdentityAuthorityProjection }>
  | Readonly<{ kind: 'malformed' }>;

const MALFORMED: IdentitySessionRefreshRotationAuthorityMySqlResult = capturedFreeze({
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

function copyExactAuthorityRow(value: unknown): UnknownRecord | undefined {
  if (
    capturedIsProxy(value) ||
    typeof value !== 'object' ||
    value === null ||
    capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== objectPrototype ||
    !hasExactKeys(capturedOwnKeys(value), AUTHORITY_ROW_KEYS)
  ) {
    return undefined;
  }

  const copy: Record<string, unknown> = {};

  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let index = 0; index < AUTHORITY_ROW_KEYS.length; index += 1) {
    const key = AUTHORITY_ROW_KEYS[index];

    if (key === undefined) return undefined;
    const descriptor = capturedGetOwnPropertyDescriptor(value, key);

    if (!isExpectedDataDescriptor(descriptor, true, true)) return undefined;
    capturedDefineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }

  return capturedFreeze(copy);
}

/** @internal Total decoder seam for the post-rotation authority projection. */
export function decodeIdentitySessionRefreshRotationAuthorityMySqlRows(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshRotationAuthorityMySqlResult {
  try {
    if (
      capturedIsProxy(value) ||
      !capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== arrayPrototype
    ) {
      return MALFORMED;
    }

    const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');
    const metaDescriptor = capturedGetOwnPropertyDescriptor(value, 'meta');

    if (
      !isExpectedDataDescriptor(lengthDescriptor, false, false) ||
      !isExpectedDataDescriptor(metaDescriptor, false, false)
    ) {
      return MALFORMED;
    }

    const rowCount: unknown = (lengthDescriptor as Readonly<{ value: unknown }>).value;

    if (
      typeof rowCount !== 'number' ||
      !capturedIsInteger(rowCount) ||
      rowCount < 0 ||
      rowCount > MAX_MYSQL_AUTHORITY_PROJECTION_ROWS ||
      capturedOwnKeys(value).length !== rowCount + 2
    ) {
      return MALFORMED;
    }

    const rows: UnknownRecord[] = [];

    for (let index = 0; index < rowCount; index += 1) {
      const rowDescriptor = capturedGetOwnPropertyDescriptor(value, index);

      if (!isExpectedDataDescriptor(rowDescriptor, true, true)) return MALFORMED;
      const rowValue: unknown = (rowDescriptor as Readonly<{ value: unknown }>).value;
      const row = copyExactAuthorityRow(rowValue);

      if (row === undefined) return MALFORMED;
      capturedDefineProperty(rows, index, {
        configurable: true,
        enumerable: true,
        value: row,
        writable: true,
      });
    }

    const mapped = capturedReflectApply(mapAuthorityProjectionRows, undefined, [rows]);

    return mapped.kind === 'resolved' ? mapped : MALFORMED;
  } catch {
    return MALFORMED;
  }
}

export type IdentitySessionRefreshRotationAuthorityMySqlStatement = MySqlTransactionStatement<
  readonly [
    accountId: string,
    accountVersion: number,
    sessionId: string,
    resultingFamilyVersion: number,
  ],
  IdentitySessionRefreshRotationAuthorityMySqlResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;

/** Non-locking authority read after all conditional rotation state writes succeed. */
export const IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT: IdentitySessionRefreshRotationAuthorityMySqlStatement =
  defineMySqlTransactionStatement({
    text: `
      SELECT
        _ascii'RESOLVED' AS authority_state,
        LOWER(BIN_TO_UUID(account.id, 0)) AS actor_id,
        LOWER(BIN_TO_UUID(family.id, 0)) AS session_id,
        LOWER(BIN_TO_UUID(assignment.role_id, 0)) AS assigned_role_id,
        LOWER(BIN_TO_UUID(role.id, 0)) AS loaded_role_id,
        role.status AS role_status,
        role_permission.permission_code AS mapped_permission_code,
        permission.code AS permission_code
      FROM identity_accounts AS account FORCE INDEX (PRIMARY)
      INNER JOIN identity_session_families AS family FORCE INDEX (PRIMARY)
        ON family.account_id = account.id
      LEFT JOIN identity_account_roles AS assignment
        ON assignment.account_id = account.id
      LEFT JOIN identity_roles AS role
        ON role.id = assignment.role_id
      LEFT JOIN identity_role_permissions AS role_permission
        ON role_permission.role_id = role.id
        AND BINARY role.status = BINARY _ascii'ACTIVE'
      LEFT JOIN identity_permissions AS permission
        ON permission.code = role_permission.permission_code
      WHERE account.id = UUID_TO_BIN(?, 0)
        AND account.version = ?
        AND BINARY account.status = BINARY _ascii'ACTIVE'
        AND account.suspended_at IS NULL
        AND account.deactivated_at IS NULL
        AND family.id = UUID_TO_BIN(?, 0)
        AND family.version = ?
        AND family.revoked_at IS NULL
        AND family.closed_reason IS NULL
      LIMIT 2049
    `,
    parameterCount: 4,
    decode: decodeIdentitySessionRefreshRotationAuthorityMySqlRows,
  });
