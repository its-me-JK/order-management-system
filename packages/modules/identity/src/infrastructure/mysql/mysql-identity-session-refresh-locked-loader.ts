import { isProxy } from 'node:util/types';

import type {
  MySqlTransactionStatementParameters,
  MySqlTransactionStatementResult,
} from '@oms/database/mysql-transaction';

import {
  IdentitySessionRefreshLockedLoadPersistenceError,
  IdentitySessionRefreshLockedLoadUnavailableError,
  type IdentitySessionRefreshLockedLoader,
} from '../../application/identity-session-refresh-locked-loader';
import {
  copyIdentityRefreshCredentialDigestBytes,
  IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
} from '../../application/identity-session-credential-digest.values';
import type { IdentitySessionRefreshDiscovery } from '../../application/identity-session-refresh-discovery';
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
import { parseIdentityInstant, type IdentityInstant } from '../../domain/identity-values';
import {
  inspectPrismaIdentitySessionRefreshDiscoveryAuthority,
  type IdentitySessionRefreshDiscoveryPrismaClient,
} from '../prisma/prisma-identity-session-refresh-discovery';
import {
  IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LOCK_PRESENTED_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LOCK_SESSION_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_READ_WRITER_TIME_MYSQL_STATEMENT,
  type IdentitySessionRefreshLockedLoadMySqlRowResult,
  type IdentitySessionRefreshLockedLoadMySqlStatement,
} from './identity-session-refresh-locked-load.statements';

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
const WRITER_TIME_ROW_KEYS = Object.freeze(['writer_time'] as const);
const NOT_FOUND_RESULT_KEYS = Object.freeze(['kind'] as const);
const FOUND_RESULT_KEYS = Object.freeze(['kind', 'row'] as const);
const MYSQL_UNSIGNED_INTEGER_MAX = 4_294_967_295;
const LOCKED_LOADER_CONSTRUCTION_CAPABILITY = Object.freeze({});
const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsFrozen = Object.isFrozen;
const capturedIsProxy = isProxy;
const capturedIsSafeInteger = Number.isSafeInteger;
const capturedOwnKeys = Reflect.ownKeys;
const capturedPromiseResolve: (value: unknown) => Promise<unknown> = Promise.resolve.bind(Promise);
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;
// eslint-disable-next-line @typescript-eslint/unbound-method
const rehydrateIdentityAccount = IdentityAccount.rehydrate;
// eslint-disable-next-line @typescript-eslint/unbound-method
const rehydrateIdentitySessionFamily = IdentitySessionFamily.rehydrate;
// eslint-disable-next-line @typescript-eslint/unbound-method
const rehydrateIdentityRefreshCredential = IdentityRefreshCredential.rehydrate;

type UnknownRecord = Readonly<Record<string, unknown>>;

/** The loader deliberately receives no transaction settlement or writer-time authority. */
export interface IdentitySessionRefreshLockedLoadMySqlContext {
  executeStatement<Statement extends IdentitySessionRefreshLockedLoadMySqlStatement>(
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>>;
}

type ExecuteStatementOperation = IdentitySessionRefreshLockedLoadMySqlContext['executeStatement'];
type LockedLoaderState = Readonly<{
  authority: ReturnType<typeof inspectPrismaIdentitySessionRefreshDiscoveryAuthority>;
  controller: IdentitySessionRefreshWorkflowController;
  executeStatement: ExecuteStatementOperation;
}>;

const lockedLoaderStates = new WeakMap<object, LockedLoaderState>();

function persistenceFailed(): never {
  throw new IdentitySessionRefreshLockedLoadPersistenceError();
}

function unavailable(): never {
  throw new IdentitySessionRefreshLockedLoadUnavailableError();
}

function isDependencyReceiver(value: unknown): value is object {
  return (
    !capturedIsProxy(value) &&
    typeof value === 'object' &&
    value !== null &&
    !capturedIsArray(value) &&
    capturedGetPrototypeOf(value) === objectPrototype &&
    capturedIsFrozen(value)
  );
}

function createExecuteStatementOperation(value: unknown): ExecuteStatementOperation {
  if (!isDependencyReceiver(value)) persistenceFailed();
  const descriptor = capturedGetOwnPropertyDescriptor(value, 'executeStatement');

  if (
    descriptor === undefined ||
    !capturedHasOwn(descriptor, 'value') ||
    descriptor.enumerable !== true ||
    descriptor.writable !== false ||
    descriptor.configurable !== false
  ) {
    persistenceFailed();
  }

  const executeStatement: unknown = descriptor.value;

  if (typeof executeStatement !== 'function') persistenceFailed();

  return <Statement extends IdentitySessionRefreshLockedLoadMySqlStatement>(
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>> => {
    const result: unknown = capturedReflectApply(executeStatement, value, [statement, parameters]);

    return capturedPromiseResolve(result) as Promise<MySqlTransactionStatementResult<Statement>>;
  };
}

function overwriteDigestBytes(value: Uint8Array<ArrayBuffer>): boolean {
  try {
    for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
      value[index] = 0;
    }

    for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
      if (value[index] !== 0) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function hasExactStringKeys(actual: readonly PropertyKey[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;

  // Indexing avoids granting mutable Array iterator authority in this mapping boundary.
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

function readDataProperty(value: object, key: string): unknown {
  const descriptor = capturedGetOwnPropertyDescriptor(value, key);

  if (
    descriptor === undefined ||
    !capturedHasOwn(descriptor, 'value') ||
    descriptor.enumerable !== true
  ) {
    persistenceFailed();
  }

  return descriptor.value;
}

function readDecodedRow(value: unknown, expectedKeys: readonly string[]): UnknownRecord | null {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== objectPrototype ||
      !capturedIsFrozen(value)
    ) {
      persistenceFailed();
    }

    const kind = readDataProperty(value, 'kind');
    const resultKeys = capturedOwnKeys(value);

    if (kind === 'malformed') persistenceFailed();

    if (kind === 'not-found') {
      if (!hasExactStringKeys(resultKeys, NOT_FOUND_RESULT_KEYS)) persistenceFailed();
      return null;
    }

    if (kind !== 'found' || !hasExactStringKeys(resultKeys, FOUND_RESULT_KEYS)) {
      persistenceFailed();
    }

    const row = readDataProperty(value, 'row');

    if (
      capturedIsProxy(row) ||
      typeof row !== 'object' ||
      row === null ||
      capturedIsArray(row) ||
      capturedGetPrototypeOf(row) !== objectPrototype ||
      !capturedIsFrozen(row) ||
      !hasExactStringKeys(capturedOwnKeys(row), expectedKeys)
    ) {
      persistenceFailed();
    }

    return row as UnknownRecord;
  } catch {
    persistenceFailed();
  }
}

function readUnsignedInteger(value: unknown): number {
  // The pinned direct MariaDB binary-protocol parser exposes UNSIGNED INT as number.
  if (
    typeof value !== 'number' ||
    !capturedIsSafeInteger(value) ||
    value < 0 ||
    value > MYSQL_UNSIGNED_INTEGER_MAX
  ) {
    persistenceFailed();
  }

  return value;
}

function readRefreshActiveSlot(value: unknown): 1 | null {
  if (value === null || value === 1) return value;
  persistenceFailed();
}

function mapAccount(row: UnknownRecord): IdentityAccount {
  return rehydrateIdentityAccount({
    id: readDataProperty(row, 'account_id'),
    loginName: readDataProperty(row, 'account_login_name'),
    status: readDataProperty(row, 'account_status'),
    version: readUnsignedInteger(readDataProperty(row, 'account_version')),
    createdAt: readDataProperty(row, 'account_created_at'),
    updatedAt: readDataProperty(row, 'account_updated_at'),
    suspendedAt: readDataProperty(row, 'account_suspended_at'),
    deactivatedAt: readDataProperty(row, 'account_deactivated_at'),
  });
}

function mapSessionFamily(row: UnknownRecord): IdentitySessionFamily {
  return rehydrateIdentitySessionFamily({
    id: readDataProperty(row, 'session_id'),
    accountId: readDataProperty(row, 'session_account_id'),
    version: readUnsignedInteger(readDataProperty(row, 'session_version')),
    createdAt: readDataProperty(row, 'session_created_at'),
    lastRotatedAt: readDataProperty(row, 'session_last_rotated_at'),
    refreshIdleExpiresAt: readDataProperty(row, 'session_idle_expires_at'),
    refreshAbsoluteExpiresAt: readDataProperty(row, 'session_absolute_expires_at'),
    revokedAt: readDataProperty(row, 'session_revoked_at'),
    closedReason: readDataProperty(row, 'session_closed_reason'),
  });
}

function mapRefreshCredential(row: UnknownRecord): IdentityRefreshCredential {
  const consumedAt = readDataProperty(row, 'refresh_consumed_at');
  const activeSlot = readRefreshActiveSlot(readDataProperty(row, 'refresh_active_slot'));

  if ((consumedAt === null && activeSlot !== 1) || (consumedAt !== null && activeSlot !== null)) {
    persistenceFailed();
  }

  return rehydrateIdentityRefreshCredential({
    id: readDataProperty(row, 'refresh_credential_id'),
    sessionId: readDataProperty(row, 'refresh_family_id'),
    sequence: readUnsignedInteger(readDataProperty(row, 'refresh_sequence')),
    issuedAt: readDataProperty(row, 'refresh_issued_at'),
    expiresAt: readDataProperty(row, 'refresh_expires_at'),
    consumedAt,
    successorId: readDataProperty(row, 'refresh_successor_id'),
  });
}

function failLoadBestEffort(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): void {
  try {
    failIdentitySessionRefreshLockedLoad(state.controller, operation);
  } catch {
    // The fixed failure selected by the caller remains the only observable value.
  }
}

function failPersistence(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): never {
  failLoadBestEffort(state, operation);
  persistenceFailed();
}

function failUnavailable(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): never {
  failLoadBestEffort(state, operation);
  unavailable();
}

async function executeStatement<Statement extends IdentitySessionRefreshLockedLoadMySqlStatement>(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
  statement: Statement,
  parameters: MySqlTransactionStatementParameters<Statement>,
): Promise<MySqlTransactionStatementResult<Statement>> {
  try {
    return await state.executeStatement(statement, parameters);
  } catch {
    failUnavailable(state, operation);
  }
}

async function queryWriterTime(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): Promise<IdentityInstant> {
  const result = await executeStatement(
    state,
    operation,
    IDENTITY_SESSION_REFRESH_READ_WRITER_TIME_MYSQL_STATEMENT,
    [],
  );
  let row: UnknownRecord | null;

  try {
    row = readDecodedRow(result, WRITER_TIME_ROW_KEYS);
  } catch {
    failPersistence(state, operation);
  }

  if (row === null) failPersistence(state, operation);

  try {
    return parseIdentityInstant(readDataProperty(row, 'writer_time'));
  } catch {
    failPersistence(state, operation);
  }
}

async function completeNotFound(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): Promise<IdentitySessionRefreshLockedLoadResult> {
  const writerTime = await queryWriterTime(state, operation);

  try {
    return completeIdentitySessionRefreshLockedLoadNotFound(
      state.controller,
      operation,
      writerTime,
    );
  } catch {
    failLoadBestEffort(state, operation);
    persistenceFailed();
  }
}

async function queryRefreshCredential(
  state: LockedLoaderState,
  operation: IdentitySessionRefreshLockedLoadOperation,
): Promise<IdentitySessionRefreshLockedLoadMySqlRowResult> {
  let digestBytes: Uint8Array<ArrayBuffer>;

  try {
    digestBytes = copyIdentityRefreshCredentialDigestBytes(operation.refreshCredentialDigest);
  } catch {
    failPersistence(state, operation);
  }

  let queryFailed = false;
  let result: IdentitySessionRefreshLockedLoadMySqlRowResult | undefined;

  try {
    result = await state.executeStatement(
      IDENTITY_SESSION_REFRESH_LOCK_PRESENTED_CREDENTIAL_MYSQL_STATEMENT,
      [operation.presentedRefreshCredentialId, operation.sessionId, digestBytes],
    );
  } catch {
    queryFailed = true;
  } finally {
    if (!overwriteDigestBytes(digestBytes)) failPersistence(state, operation);
  }

  if (queryFailed) failUnavailable(state, operation);
  if (result === undefined) failPersistence(state, operation);
  return result;
}

class MySqlIdentitySessionRefreshLockedLoaderRuntime implements IdentitySessionRefreshLockedLoader {
  public constructor(capability: object, state: LockedLoaderState) {
    if (capability !== LOCKED_LOADER_CONSTRUCTION_CAPABILITY) persistenceFailed();
    capturedReflectApply(capturedWeakMapSet, lockedLoaderStates, [this, state]);
    capturedFreeze(this);
  }

  public async loadForUpdate(
    scope: Parameters<IdentitySessionRefreshLockedLoader['loadForUpdate']>[0],
    ticket: Parameters<IdentitySessionRefreshLockedLoader['loadForUpdate']>[1],
  ): Promise<IdentitySessionRefreshLockedLoadResult> {
    const state = capturedReflectApply(capturedWeakMapGet, lockedLoaderStates, [this]) as
      LockedLoaderState | undefined;

    if (state === undefined) persistenceFailed();
    const operation = beginIdentitySessionRefreshLockedLoad(
      state.controller,
      scope,
      state.authority,
      ticket,
    );
    const accountResult = await executeStatement(
      state,
      operation,
      IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT,
      [operation.accountId],
    );
    let accountRow: UnknownRecord | null;

    try {
      accountRow = readDecodedRow(accountResult, ACCOUNT_ROW_KEYS);
    } catch {
      failPersistence(state, operation);
    }

    if (accountRow === null) return completeNotFound(state, operation);
    let account: IdentityAccount;

    try {
      account = mapAccount(accountRow);
    } catch {
      failPersistence(state, operation);
    }

    const familyResult = await executeStatement(
      state,
      operation,
      IDENTITY_SESSION_REFRESH_LOCK_SESSION_FAMILY_MYSQL_STATEMENT,
      [operation.sessionId, operation.accountId],
    );
    let familyRow: UnknownRecord | null;

    try {
      familyRow = readDecodedRow(familyResult, SESSION_FAMILY_ROW_KEYS);
    } catch {
      failPersistence(state, operation);
    }

    if (familyRow === null) return completeNotFound(state, operation);
    let sessionFamily: IdentitySessionFamily;

    try {
      sessionFamily = mapSessionFamily(familyRow);
    } catch {
      failPersistence(state, operation);
    }

    const credentialResult = await queryRefreshCredential(state, operation);
    let credentialRow: UnknownRecord | null;

    try {
      credentialRow = readDecodedRow(credentialResult, REFRESH_CREDENTIAL_ROW_KEYS);
    } catch {
      failPersistence(state, operation);
    }

    if (credentialRow === null) return completeNotFound(state, operation);
    let refreshCredential: IdentityRefreshCredential;

    try {
      refreshCredential = mapRefreshCredential(credentialRow);
    } catch {
      failPersistence(state, operation);
    }

    const writerTime = await queryWriterTime(state, operation);

    try {
      return completeIdentitySessionRefreshLockedLoadFound(
        state.controller,
        operation,
        account,
        sessionFamily,
        refreshCredential,
        writerTime,
      );
    } catch {
      failLoadBestEffort(state, operation);
      persistenceFailed();
    }
  }
}

capturedFreeze(MySqlIdentitySessionRefreshLockedLoaderRuntime.prototype);
capturedFreeze(MySqlIdentitySessionRefreshLockedLoaderRuntime);

/** @internal Creates a lifecycle-blind loader over one already-active direct transaction. */
export function createMySqlIdentitySessionRefreshLockedLoader(
  writerClient: IdentitySessionRefreshDiscoveryPrismaClient,
  context: IdentitySessionRefreshLockedLoadMySqlContext,
  discovery: IdentitySessionRefreshDiscovery,
  controller: IdentitySessionRefreshWorkflowController,
): IdentitySessionRefreshLockedLoader {
  try {
    // Pairing is authenticated before the context is inspected or a workflow can start.
    const authority = inspectPrismaIdentitySessionRefreshDiscoveryAuthority(
      discovery,
      writerClient,
    );
    const state = capturedFreeze({
      authority,
      controller,
      executeStatement: createExecuteStatementOperation(context),
    });

    return new MySqlIdentitySessionRefreshLockedLoaderRuntime(
      LOCKED_LOADER_CONSTRUCTION_CAPABILITY,
      state,
    );
  } catch {
    persistenceFailed();
  }
}
