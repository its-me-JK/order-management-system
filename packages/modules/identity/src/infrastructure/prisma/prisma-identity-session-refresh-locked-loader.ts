import { isPrismaDatabaseUnavailableError, type Prisma } from '@oms/database/prisma';

import {
  IdentitySessionRefreshLockedLoadPersistenceError,
  IdentitySessionRefreshLockedLoadUnavailableError,
  type IdentitySessionRefreshLockedLoader,
} from '../../application/identity-session-refresh-locked-loader';
import {
  copyIdentityRefreshCredentialDigestBytes,
  IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
} from '../../application/identity-session-credential-digest.values';
import type {
  IdentitySessionRefreshDiscovery,
  IdentitySessionRefreshDiscoveryBoundaryAuthority,
} from '../../application/identity-session-refresh-discovery';
import {
  beginIdentitySessionRefreshLockedLoad,
  completeIdentitySessionRefreshLockedLoadFound,
  completeIdentitySessionRefreshLockedLoadNotFound,
  failIdentitySessionRefreshLockedLoad,
  type IdentitySessionRefreshLockedLoadOperation,
  type IdentitySessionRefreshLockedLoadResult,
  type IdentitySessionRefreshWorkflowController,
} from '../../application/identity-session-refresh-workflow';
import { IdentityAccount } from '../../domain/identity-account';
import { IdentityRefreshCredential } from '../../domain/identity-refresh-credential';
import { IdentitySessionFamily } from '../../domain/identity-session-family';
import {
  inspectPrismaIdentitySessionRefreshDiscoveryAuthority,
  type IdentitySessionRefreshDiscoveryPrismaClient,
} from './prisma-identity-session-refresh-discovery';

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
const LOCKED_LOAD_OVERFLOW_PROBE_ROW_COUNT = 2;
const MYSQL_UNSIGNED_INTEGER_MAX = 4_294_967_295n;
const LOCKED_LOADER_CONSTRUCTION_CAPABILITY = Object.freeze({});
const capturedNumber = Number;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedOwnKeys = Reflect.ownKeys;
const capturedPromiseResolve: (value: unknown) => Promise<unknown> = Promise.resolve.bind(Promise);
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const rehydrateIdentityAccount = IdentityAccount.rehydrate;
// eslint-disable-next-line @typescript-eslint/unbound-method
const rehydrateIdentitySessionFamily = IdentitySessionFamily.rehydrate;
// eslint-disable-next-line @typescript-eslint/unbound-method
const rehydrateIdentityRefreshCredential = IdentityRefreshCredential.rehydrate;

export type IdentitySessionRefreshLockedLoaderPrismaTransactionClient = Pick<
  Prisma.TransactionClient,
  '$queryRaw'
>;

type QueryRawOperation = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
type LockedLoaderState = Readonly<{
  authority: IdentitySessionRefreshDiscoveryBoundaryAuthority;
  controller: IdentitySessionRefreshWorkflowController;
  queryRaw: QueryRawOperation;
}>;
type UnknownRecord = Readonly<Record<string, unknown>>;

const lockedLoaderStates = new WeakMap<object, LockedLoaderState>();

function persistenceFailed(): never {
  throw new IdentitySessionRefreshLockedLoadPersistenceError();
}

function unavailable(): never {
  throw new IdentitySessionRefreshLockedLoadUnavailableError();
}

function isDependencyReceiver(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !capturedIsArray(value);
}

function createQueryRawOperation(value: unknown): QueryRawOperation {
  if (!isDependencyReceiver(value)) {
    persistenceFailed();
  }

  const queryRaw: unknown = capturedReflectGet(value, '$queryRaw');

  if (typeof queryRaw !== 'function') {
    persistenceFailed();
  }

  return (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
    const result: unknown = capturedReflectApply(queryRaw, value, [strings, ...values]);

    return capturedPromiseResolve(result);
  };
}

function overwriteDigestBytes(value: Uint8Array<ArrayBuffer>): boolean {
  try {
    for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
      value[index] = 0;
    }

    for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
      if (value[index] !== 0) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function readExactRow(value: unknown, expectedKeys: readonly string[]): UnknownRecord | null {
  if (!capturedIsArray(value)) {
    persistenceFailed();
  }

  const arrayKeys = capturedOwnKeys(value);
  const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');

  if (
    lengthDescriptor === undefined ||
    !capturedHasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false
  ) {
    persistenceFailed();
  }

  const rowCount: unknown = (lengthDescriptor as Readonly<{ value: unknown }>).value;

  if (rowCount === 0) {
    if (arrayKeys.length !== 1 || arrayKeys[0] !== 'length') {
      persistenceFailed();
    }

    return null;
  }

  if (
    rowCount !== 1 ||
    arrayKeys.length !== 2 ||
    !arrayKeys.some((key) => key === '0') ||
    !arrayKeys.some((key) => key === 'length')
  ) {
    persistenceFailed();
  }

  const rowDescriptor = capturedGetOwnPropertyDescriptor(value, '0');

  if (
    rowDescriptor === undefined ||
    !capturedHasOwn(rowDescriptor, 'value') ||
    rowDescriptor.enumerable !== true
  ) {
    persistenceFailed();
  }

  const rowValue: unknown = (rowDescriptor as Readonly<{ value: unknown }>).value;

  if (typeof rowValue !== 'object' || rowValue === null || capturedIsArray(rowValue)) {
    persistenceFailed();
  }

  const row = rowValue as UnknownRecord;
  const rowKeys = capturedOwnKeys(row);

  if (
    rowKeys.length !== expectedKeys.length ||
    rowKeys.some(
      (key) => typeof key !== 'string' || !expectedKeys.some((expectedKey) => expectedKey === key),
    )
  ) {
    persistenceFailed();
  }

  const copied: Record<string, unknown> = {};

  for (const key of expectedKeys) {
    const descriptor = capturedGetOwnPropertyDescriptor(row, key);

    if (
      descriptor === undefined ||
      !capturedHasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true
    ) {
      persistenceFailed();
    }

    copied[key] = (descriptor as Readonly<{ value: unknown }>).value;
  }

  return capturedFreeze(copied);
}

function readUnsignedInteger(value: unknown, maximum: bigint): number {
  // Prisma's MariaDB adapter exposes MySQL INTEGER UNSIGNED projections as bigint.
  // Normalize only after proving the database width so domain parsers still own semantic bounds.
  if (typeof value !== 'bigint' || value < 0n || value > maximum) {
    persistenceFailed();
  }

  return capturedNumber(value);
}

function readRefreshActiveSlot(value: unknown): 1 | null {
  // The same adapter exposes TINYINT UNSIGNED as number; the schema permits only 1 or NULL.
  if (value === null || value === 1) {
    return value;
  }

  persistenceFailed();
}

function mapAccount(row: UnknownRecord): IdentityAccount {
  return rehydrateIdentityAccount({
    id: row['account_id'],
    loginName: row['account_login_name'],
    status: row['account_status'],
    version: readUnsignedInteger(row['account_version'], MYSQL_UNSIGNED_INTEGER_MAX),
    createdAt: row['account_created_at'],
    updatedAt: row['account_updated_at'],
    suspendedAt: row['account_suspended_at'],
    deactivatedAt: row['account_deactivated_at'],
  });
}

function mapSessionFamily(row: UnknownRecord): IdentitySessionFamily {
  return rehydrateIdentitySessionFamily({
    id: row['session_id'],
    accountId: row['session_account_id'],
    version: readUnsignedInteger(row['session_version'], MYSQL_UNSIGNED_INTEGER_MAX),
    createdAt: row['session_created_at'],
    lastRotatedAt: row['session_last_rotated_at'],
    refreshIdleExpiresAt: row['session_idle_expires_at'],
    refreshAbsoluteExpiresAt: row['session_absolute_expires_at'],
    revokedAt: row['session_revoked_at'],
    closedReason: row['session_closed_reason'],
  });
}

function mapRefreshCredential(row: UnknownRecord): IdentityRefreshCredential {
  const consumedAt = row['refresh_consumed_at'];
  const activeSlot = readRefreshActiveSlot(row['refresh_active_slot']);

  if ((consumedAt === null && activeSlot !== 1) || (consumedAt !== null && activeSlot !== null)) {
    persistenceFailed();
  }

  return rehydrateIdentityRefreshCredential({
    id: row['refresh_credential_id'],
    sessionId: row['refresh_family_id'],
    sequence: readUnsignedInteger(row['refresh_sequence'], MYSQL_UNSIGNED_INTEGER_MAX),
    issuedAt: row['refresh_issued_at'],
    expiresAt: row['refresh_expires_at'],
    consumedAt,
    successorId: row['refresh_successor_id'],
  });
}

function failLoadBestEffort(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): void {
  try {
    failIdentitySessionRefreshLockedLoad(state.controller, operation);
  } catch {
    // The fixed persistence error below remains the only observable failure.
  }
}

function failPersistence(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): never {
  failLoadBestEffort(state, operation);
  persistenceFailed();
}

function failQuery(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
  error: unknown,
): never {
  failLoadBestEffort(state, operation);
  let databaseUnavailable = false;

  try {
    databaseUnavailable = isPrismaDatabaseUnavailableError(error);
  } catch {
    // A classifier defect is an internal persistence failure below.
  }

  if (databaseUnavailable) {
    unavailable();
  }

  persistenceFailed();
}

function completeNotFound(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): IdentitySessionRefreshLockedLoadResult {
  try {
    return completeIdentitySessionRefreshLockedLoadNotFound(state.controller, operation);
  } catch {
    failLoadBestEffort(state, operation);
    persistenceFailed();
  }
}

async function queryAccount(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): Promise<unknown> {
  try {
    return await state.queryRaw`
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
      WHERE account.id = UUID_TO_BIN(${operation.accountId}, 0)
      LIMIT ${LOCKED_LOAD_OVERFLOW_PROBE_ROW_COUNT}
      FOR UPDATE
    `;
  } catch (error: unknown) {
    failQuery(state, operation, error);
  }
}

async function querySessionFamily(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): Promise<unknown> {
  try {
    return await state.queryRaw`
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
      WHERE family.id = UUID_TO_BIN(${operation.sessionId}, 0)
        AND family.account_id = UUID_TO_BIN(${operation.accountId}, 0)
      LIMIT ${LOCKED_LOAD_OVERFLOW_PROBE_ROW_COUNT}
      FOR UPDATE
    `;
  } catch (error: unknown) {
    failQuery(state, operation, error);
  }
}

async function queryRefreshCredential(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): Promise<unknown> {
  let digestBytes: Uint8Array<ArrayBuffer>;

  try {
    digestBytes = copyIdentityRefreshCredentialDigestBytes(operation.refreshCredentialDigest);
  } catch {
    failPersistence(state, operation);
  }

  let queryFailed = false;
  let queryFailure: unknown;
  let result: unknown;

  try {
    result = await state.queryRaw`
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
      WHERE refresh.id = UUID_TO_BIN(${operation.presentedRefreshCredentialId}, 0)
        AND refresh.family_id = UUID_TO_BIN(${operation.sessionId}, 0)
        AND refresh.digest = ${digestBytes}
      LIMIT ${LOCKED_LOAD_OVERFLOW_PROBE_ROW_COUNT}
      FOR UPDATE
    `;
  } catch (error: unknown) {
    queryFailed = true;
    queryFailure = error;
  }

  if (!overwriteDigestBytes(digestBytes)) {
    failPersistence(state, operation);
  }

  if (queryFailed) {
    failQuery(state, operation, queryFailure);
  }

  return result;
}

class PrismaIdentitySessionRefreshLockedLoaderRuntime implements IdentitySessionRefreshLockedLoader {
  public constructor(capability: object, state: LockedLoaderState) {
    if (capability !== LOCKED_LOADER_CONSTRUCTION_CAPABILITY) {
      persistenceFailed();
    }

    lockedLoaderStates.set(this, state);
    capturedFreeze(this);
  }

  public async loadForUpdate(
    scope: Parameters<IdentitySessionRefreshLockedLoader['loadForUpdate']>[0],
    ticket: Parameters<IdentitySessionRefreshLockedLoader['loadForUpdate']>[1],
  ): Promise<IdentitySessionRefreshLockedLoadResult> {
    const state = lockedLoaderStates.get(this);

    if (state === undefined) {
      persistenceFailed();
    }

    const operation = beginIdentitySessionRefreshLockedLoad(
      state.controller,
      scope,
      state.authority,
      ticket,
    );
    let accountRow: UnknownRecord | null;

    const accountResult = await queryAccount(state, operation);

    try {
      accountRow = readExactRow(accountResult, ACCOUNT_ROW_KEYS);
    } catch {
      failPersistence(state, operation);
    }

    if (accountRow === null) {
      return completeNotFound(state, operation);
    }

    let account: IdentityAccount;

    try {
      account = mapAccount(accountRow);
    } catch {
      failPersistence(state, operation);
    }

    let familyRow: UnknownRecord | null;

    const familyResult = await querySessionFamily(state, operation);

    try {
      familyRow = readExactRow(familyResult, SESSION_FAMILY_ROW_KEYS);
    } catch {
      failPersistence(state, operation);
    }

    if (familyRow === null) {
      return completeNotFound(state, operation);
    }

    let sessionFamily: IdentitySessionFamily;

    try {
      sessionFamily = mapSessionFamily(familyRow);
    } catch {
      failPersistence(state, operation);
    }

    let credentialRow: UnknownRecord | null;

    const credentialResult = await queryRefreshCredential(state, operation);

    try {
      credentialRow = readExactRow(credentialResult, REFRESH_CREDENTIAL_ROW_KEYS);
    } catch {
      failPersistence(state, operation);
    }

    if (credentialRow === null) {
      return completeNotFound(state, operation);
    }

    let refreshCredential: IdentityRefreshCredential;

    try {
      refreshCredential = mapRefreshCredential(credentialRow);
    } catch {
      failPersistence(state, operation);
    }

    try {
      return completeIdentitySessionRefreshLockedLoadFound(
        state.controller,
        operation,
        account,
        sessionFamily,
        refreshCredential,
      );
    } catch {
      failLoadBestEffort(state, operation);
      persistenceFailed();
    }
  }
}

capturedFreeze(PrismaIdentitySessionRefreshLockedLoaderRuntime.prototype);
capturedFreeze(PrismaIdentitySessionRefreshLockedLoaderRuntime);

/** @internal Creates one paired loader over an already-active writer transaction. */
export function createPrismaIdentitySessionRefreshLockedLoader(
  writerClient: IdentitySessionRefreshDiscoveryPrismaClient,
  transactionClient: IdentitySessionRefreshLockedLoaderPrismaTransactionClient,
  discovery: IdentitySessionRefreshDiscovery,
  controller: IdentitySessionRefreshWorkflowController,
): IdentitySessionRefreshLockedLoader {
  try {
    const state = capturedFreeze({
      authority: inspectPrismaIdentitySessionRefreshDiscoveryAuthority(discovery, writerClient),
      controller,
      queryRaw: createQueryRawOperation(transactionClient),
    });

    return new PrismaIdentitySessionRefreshLockedLoaderRuntime(
      LOCKED_LOADER_CONSTRUCTION_CAPABILITY,
      state,
    );
  } catch {
    persistenceFailed();
  }
}
