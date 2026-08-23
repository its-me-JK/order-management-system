import { isProxy } from 'node:util/types';

import type {
  MySqlTransactionStatementParameters,
  MySqlTransactionStatementResult,
} from '@oms/database/mysql-transaction';

import type {
  IdentitySessionRefreshRotatedStoreInput,
  IdentitySessionRefreshStore,
} from '../../application/identity-session-refresh-command';
import {
  copyIdentityAccessCredentialDigestBytes,
  copyIdentityRefreshCredentialDigestBytes,
  IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
} from '../../application/identity-session-credential-digest.values';
import {
  beginIdentitySessionRefreshRotatedPersistence,
  completeIdentitySessionRefreshRotatedPersistence,
  failIdentitySessionRefreshPersistence,
  inspectIdentitySessionRefreshRotatedPersistence,
  type IdentitySessionRefreshRotatedPersistenceAction,
  type IdentitySessionRefreshWorkflowController,
} from '../../application/identity-session-refresh-workflow';
import { IdentityAccessCredential } from '../../domain/identity-access-credential';
import { IdentityRefreshCredential } from '../../domain/identity-refresh-credential';
import { IdentitySessionFamily } from '../../domain/identity-session-family';
import {
  IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
  type IdentitySessionRefreshRotationAuthorityMySqlResult,
} from './identity-session-refresh-rotation-authority.statement';
import {
  IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
  type IdentitySessionRefreshRotationMySqlStatement,
} from './identity-session-refresh-rotation.statements';

const STORE_INPUT_KEYS = Object.freeze(['decision', 'securityEventId'] as const);
const WRITE_RESULT_KEYS = Object.freeze(['kind'] as const);
const AUTHORITY_RESULT_KEYS = Object.freeze(['kind', 'projection'] as const);
const WRITER_CONSTRUCTION_CAPABILITY = Object.freeze({});
const CONDITIONAL_CONFLICT_CONSTRUCTION_CAPABILITY = Object.freeze({});
const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsFrozen = Object.isFrozen;
const capturedIsProxy = isProxy;
const capturedOwnKeys = Reflect.ownKeys;
const capturedPromiseResolve: (value: unknown) => Promise<unknown> = Promise.resolve.bind(Promise);
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedUint8ArrayFill = Uint8Array.prototype.fill;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakSetAdd = WeakSet.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakSetHas = WeakSet.prototype.has;
// eslint-disable-next-line @typescript-eslint/unbound-method
const accessCredentialSnapshot = IdentityAccessCredential.prototype.toSnapshot;
// eslint-disable-next-line @typescript-eslint/unbound-method
const refreshCredentialSnapshot = IdentityRefreshCredential.prototype.toSnapshot;
// eslint-disable-next-line @typescript-eslint/unbound-method
const sessionFamilySnapshot = IdentitySessionFamily.prototype.toSnapshot;

type ExecuteStatementOperation =
  IdentitySessionRefreshRotatedPersistenceMySqlContext['executeStatement'];
type RotatedWriter = Pick<IdentitySessionRefreshStore, 'persistRotated'>;
type WriterStoreInput = Readonly<{
  decision: IdentitySessionRefreshRotatedStoreInput['decision'];
  securityEventId: IdentitySessionRefreshRotatedStoreInput['securityEventId'];
}>;
type RotationPersistenceMaterial = Readonly<{
  consumeParameters: MySqlTransactionStatementParameters<
    typeof IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT
  >;
  successor: Readonly<{
    id: string;
    sessionId: string;
    sequence: number;
    issuedAt: string;
    expiresAt: string;
  }>;
  access: Readonly<{
    id: string;
    sessionId: string;
    sequence: number;
    issuedAt: string;
    expiresAt: string;
  }>;
  linkParameters: MySqlTransactionStatementParameters<
    typeof IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT
  >;
  advanceParameters: MySqlTransactionStatementParameters<
    typeof IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT
  >;
  authorityParameters: MySqlTransactionStatementParameters<
    typeof IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT
  >;
  eventParameters: MySqlTransactionStatementParameters<
    typeof IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT
  >;
}>;
type WriterState = Readonly<{
  controller: IdentitySessionRefreshWorkflowController;
  executeStatement: ExecuteStatementOperation;
}>;

/** The writer receives neither transaction settlement nor credential-delivery authority. */
export interface IdentitySessionRefreshRotatedPersistenceMySqlContext {
  executeStatement<Statement extends IdentitySessionRefreshRotationMySqlStatement>(
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>>;
}

class IdentitySessionRefreshRotatedPersistenceError extends Error {
  public constructor() {
    super('Identity session refresh rotation persistence failed');
    this.name = 'IdentitySessionRefreshRotatedPersistenceError';
  }
}

class IdentitySessionRefreshRotatedConditionalConflictError extends Error {
  public constructor(capability: object) {
    if (capability !== CONDITIONAL_CONFLICT_CONSTRUCTION_CAPABILITY) persistenceFailed();
    super('Identity session refresh rotation persistence encountered a conditional conflict');
    this.name = 'IdentitySessionRefreshRotatedConditionalConflictError';
  }
}

const writerStates = new WeakMap<object, WriterState>();
const conditionalConflictErrors = new WeakSet<object>();

function persistenceFailed(): never {
  throw new IdentitySessionRefreshRotatedPersistenceError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function hasExactStringKeys(actual: readonly PropertyKey[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;

  // Indexing avoids granting mutable Array iterator authority at this boundary.
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

function readFrozenDataProperty(value: object, key: string): unknown {
  const descriptor = capturedGetOwnPropertyDescriptor(value, key);

  if (
    descriptor === undefined ||
    !capturedHasOwn(descriptor, 'value') ||
    descriptor.enumerable !== true ||
    descriptor.writable !== false ||
    descriptor.configurable !== false
  ) {
    persistenceFailed();
  }

  return descriptor.value;
}

function readStoreInput(value: unknown): WriterStoreInput {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== objectPrototype ||
      !capturedIsFrozen(value) ||
      !hasExactStringKeys(capturedOwnKeys(value), STORE_INPUT_KEYS)
    ) {
      persistenceFailed();
    }

    return capturedFreeze({
      decision: readFrozenDataProperty(value, 'decision'),
      securityEventId: readFrozenDataProperty(value, 'securityEventId'),
    }) as WriterStoreInput;
  } catch {
    persistenceFailed();
  }
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

  return <Statement extends IdentitySessionRefreshRotationMySqlStatement>(
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>> => {
    const result: unknown = capturedReflectApply(executeStatement, value, [statement, parameters]);

    return capturedPromiseResolve(result) as Promise<MySqlTransactionStatementResult<Statement>>;
  };
}

function readWriteResultKind(value: unknown): 'changed' | 'no-match' | 'malformed' {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== objectPrototype ||
      !capturedIsFrozen(value) ||
      !hasExactStringKeys(capturedOwnKeys(value), WRITE_RESULT_KEYS)
    ) {
      persistenceFailed();
    }

    const kind = readFrozenDataProperty(value, 'kind');

    if (kind !== 'changed' && kind !== 'no-match' && kind !== 'malformed') {
      persistenceFailed();
    }

    return kind;
  } catch {
    persistenceFailed();
  }
}

function readResolvedAuthorityProjection(value: unknown): unknown {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== objectPrototype ||
      !capturedIsFrozen(value) ||
      !hasExactStringKeys(capturedOwnKeys(value), AUTHORITY_RESULT_KEYS) ||
      readFrozenDataProperty(value, 'kind') !== 'resolved'
    ) {
      persistenceFailed();
    }

    return readFrozenDataProperty(value, 'projection');
  } catch {
    persistenceFailed();
  }
}

function extractPersistenceMaterial(
  plan: ReturnType<typeof inspectIdentitySessionRefreshRotatedPersistence>,
): RotationPersistenceMaterial {
  const result = plan.result;
  const basis = result.basis;
  const family = capturedReflectApply(sessionFamilySnapshot, result.sessionFamily, []);
  const consumed = capturedReflectApply(
    refreshCredentialSnapshot,
    result.consumedRefreshCredential,
    [],
  );
  const successor = capturedReflectApply(
    refreshCredentialSnapshot,
    result.successorRefreshCredential,
    [],
  );
  const access = capturedReflectApply(accessCredentialSnapshot, result.issuedAccessCredential, []);
  const fact = result.facts[0];

  if (
    family.id !== basis.sessionId ||
    family.accountId !== basis.accountId ||
    family.version !== basis.sessionFamilyVersion + 1 ||
    family.lastRotatedAt !== consumed.consumedAt ||
    family.lastRotatedAt !== successor.issuedAt ||
    family.refreshIdleExpiresAt !== successor.expiresAt ||
    family.revokedAt !== null ||
    family.closedReason !== null ||
    consumed.id !== basis.presentedRefreshCredentialId ||
    consumed.sessionId !== basis.sessionId ||
    consumed.sequence !== basis.presentedRefreshCredentialSequence ||
    consumed.successorId !== successor.id ||
    successor.sessionId !== basis.sessionId ||
    successor.sequence !== basis.presentedRefreshCredentialSequence + 1 ||
    successor.consumedAt !== null ||
    successor.successorId !== null ||
    access.sessionId !== basis.sessionId ||
    access.sequence !== successor.sequence ||
    access.issuedAt !== successor.issuedAt ||
    fact.accountId !== basis.accountId ||
    fact.sessionId !== basis.sessionId ||
    fact.version !== family.version ||
    fact.occurredAt !== family.lastRotatedAt
  ) {
    persistenceFailed();
  }

  return capturedFreeze({
    consumeParameters: capturedFreeze([
      consumed.consumedAt,
      consumed.id,
      consumed.sessionId,
      consumed.sequence,
      consumed.issuedAt,
      consumed.expiresAt,
    ] as const),
    successor: capturedFreeze({
      id: successor.id,
      sessionId: successor.sessionId,
      sequence: successor.sequence,
      issuedAt: successor.issuedAt,
      expiresAt: successor.expiresAt,
    }),
    access: capturedFreeze({
      id: access.id,
      sessionId: access.sessionId,
      sequence: access.sequence,
      issuedAt: access.issuedAt,
      expiresAt: access.expiresAt,
    }),
    linkParameters: capturedFreeze([
      successor.id,
      consumed.id,
      consumed.sessionId,
      consumed.sequence,
      consumed.issuedAt,
      consumed.expiresAt,
      consumed.consumedAt,
    ] as const),
    advanceParameters: capturedFreeze([
      family.version,
      family.lastRotatedAt,
      family.refreshIdleExpiresAt,
      family.id,
      family.accountId,
      basis.sessionFamilyVersion,
      family.createdAt,
      consumed.issuedAt,
      consumed.expiresAt,
      family.refreshAbsoluteExpiresAt,
      basis.accountVersion,
      consumed.id,
      consumed.sequence,
      consumed.consumedAt,
      consumed.successorId,
      successor.id,
      successor.sequence,
      successor.issuedAt,
      successor.expiresAt,
      access.id,
      access.sequence,
      access.issuedAt,
      access.expiresAt,
    ] as const),
    authorityParameters: capturedFreeze([
      basis.accountId,
      basis.accountVersion,
      basis.sessionId,
      family.version,
    ] as const),
    eventParameters: capturedFreeze([
      plan.securityEventId,
      basis.accountId,
      basis.accountId,
      basis.sessionId,
      fact.occurredAt,
    ] as const),
  });
}

function failActionBestEffort(
  state: WriterState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
): boolean {
  try {
    failIdentitySessionRefreshPersistence(state.controller, action);
    return true;
  } catch {
    // The selected fixed writer failure remains the sole observable value.
    return false;
  }
}

function failAfterAction(
  state: WriterState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
): never {
  failActionBestEffort(state, action);
  persistenceFailed();
}

function conditionalConflictAfterAction(
  state: WriterState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
): never {
  if (!failActionBestEffort(state, action)) persistenceFailed();
  const error = new IdentitySessionRefreshRotatedConditionalConflictError(
    CONDITIONAL_CONFLICT_CONSTRUCTION_CAPABILITY,
  );

  capturedReflectApply(capturedWeakSetAdd, conditionalConflictErrors, [error]);
  capturedFreeze(error);
  throw error;
}

function eraseDigestBytes(value: Uint8Array<ArrayBuffer>): boolean {
  try {
    capturedReflectApply(capturedUint8ArrayFill, value, [0]);

    for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
      if (value[index] !== 0) return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function executeStatement<Statement extends IdentitySessionRefreshRotationMySqlStatement>(
  state: WriterState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
  statement: Statement,
  parameters: MySqlTransactionStatementParameters<Statement>,
): Promise<MySqlTransactionStatementResult<Statement>> {
  try {
    return await state.executeStatement(statement, parameters);
  } catch {
    failAfterAction(state, action);
  }
}

async function executeStatementWithOwnedDigest<
  Statement extends IdentitySessionRefreshRotationMySqlStatement,
>(
  state: WriterState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
  statement: Statement,
  parameters: MySqlTransactionStatementParameters<Statement>,
  digestBytes: Uint8Array<ArrayBuffer>,
): Promise<MySqlTransactionStatementResult<Statement>> {
  let result: MySqlTransactionStatementResult<Statement>;

  try {
    result = await state.executeStatement(statement, parameters);
  } catch {
    if (!eraseDigestBytes(digestBytes)) failAfterAction(state, action);
    failAfterAction(state, action);
  }

  if (!eraseDigestBytes(digestBytes)) failAfterAction(state, action);
  return result;
}

function requireChanged(
  state: WriterState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
  result: unknown,
): void {
  try {
    if (readWriteResultKind(result) !== 'changed') failAfterAction(state, action);
  } catch {
    failAfterAction(state, action);
  }
}

function requireConditionalChanged(
  state: WriterState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
  result: unknown,
): void {
  let kind: ReturnType<typeof readWriteResultKind>;

  try {
    kind = readWriteResultKind(result);
  } catch {
    failAfterAction(state, action);
  }

  if (kind === 'no-match') conditionalConflictAfterAction(state, action);
  if (kind !== 'changed') failAfterAction(state, action);
}

class MySqlIdentitySessionRefreshRotatedWriterRuntime implements RotatedWriter {
  public constructor(capability: object, state: WriterState) {
    if (capability !== WRITER_CONSTRUCTION_CAPABILITY) persistenceFailed();
    capturedReflectApply(capturedWeakMapSet, writerStates, [this, state]);
    capturedFreeze(this);
  }

  public async persistRotated(
    scope: Parameters<RotatedWriter['persistRotated']>[0],
    inputValue: Parameters<RotatedWriter['persistRotated']>[1],
  ): ReturnType<RotatedWriter['persistRotated']> {
    const state = capturedReflectApply(capturedWeakMapGet, writerStates, [this]) as
      WriterState | undefined;

    if (state === undefined) persistenceFailed();
    const input = readStoreInput(inputValue);
    const action = beginIdentitySessionRefreshRotatedPersistence(
      state.controller,
      scope,
      input.decision,
      input.securityEventId,
    );
    let plan: ReturnType<typeof inspectIdentitySessionRefreshRotatedPersistence>;
    let material: RotationPersistenceMaterial;

    try {
      plan = inspectIdentitySessionRefreshRotatedPersistence(state.controller, action);
      material = extractPersistenceMaterial(plan);
    } catch {
      failAfterAction(state, action);
    }

    const consumeResult = await executeStatement(
      state,
      action,
      IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
      material.consumeParameters,
    );
    requireConditionalChanged(state, action, consumeResult);

    let refreshDigestBytes: Uint8Array<ArrayBuffer>;

    try {
      refreshDigestBytes = copyIdentityRefreshCredentialDigestBytes(plan.refreshCredentialDigest);
    } catch {
      failAfterAction(state, action);
    }

    const successorParameters = capturedFreeze([
      material.successor.id,
      material.successor.sessionId,
      refreshDigestBytes,
      material.successor.sequence,
      material.successor.issuedAt,
      material.successor.expiresAt,
    ] as const);
    const successorResult = await executeStatementWithOwnedDigest(
      state,
      action,
      IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
      successorParameters,
      refreshDigestBytes,
    );
    requireChanged(state, action, successorResult);

    let accessDigestBytes: Uint8Array<ArrayBuffer>;

    try {
      accessDigestBytes = copyIdentityAccessCredentialDigestBytes(plan.accessCredentialDigest);
    } catch {
      failAfterAction(state, action);
    }

    const accessParameters = capturedFreeze([
      material.access.id,
      material.access.sessionId,
      accessDigestBytes,
      material.access.sequence,
      material.access.issuedAt,
      material.access.expiresAt,
    ] as const);
    const accessResult = await executeStatementWithOwnedDigest(
      state,
      action,
      IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
      accessParameters,
      accessDigestBytes,
    );
    requireChanged(state, action, accessResult);

    const linkResult = await executeStatement(
      state,
      action,
      IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
      material.linkParameters,
    );
    requireConditionalChanged(state, action, linkResult);

    const advanceResult = await executeStatement(
      state,
      action,
      IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
      material.advanceParameters,
    );
    requireConditionalChanged(state, action, advanceResult);

    const authorityResult: IdentitySessionRefreshRotationAuthorityMySqlResult =
      await executeStatement(
        state,
        action,
        IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
        material.authorityParameters,
      );
    let authorityProjection: unknown;

    try {
      authorityProjection = readResolvedAuthorityProjection(authorityResult);
    } catch {
      failAfterAction(state, action);
    }

    const eventResult = await executeStatement(
      state,
      action,
      IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
      material.eventParameters,
    );
    requireChanged(state, action, eventResult);

    try {
      return completeIdentitySessionRefreshRotatedPersistence(
        state.controller,
        action,
        authorityProjection,
      );
    } catch {
      failAfterAction(state, action);
    }
  }
}

capturedFreeze(IdentitySessionRefreshRotatedPersistenceError.prototype);
capturedFreeze(IdentitySessionRefreshRotatedPersistenceError);
capturedFreeze(IdentitySessionRefreshRotatedConditionalConflictError.prototype);
capturedFreeze(IdentitySessionRefreshRotatedConditionalConflictError);
capturedFreeze(MySqlIdentitySessionRefreshRotatedWriterRuntime.prototype);
capturedFreeze(MySqlIdentitySessionRefreshRotatedWriterRuntime);

/** @internal Recognizes only the writer-created zero-row conditional-conflict signal. */
export function isMySqlIdentitySessionRefreshRotatedConditionalConflict(value: unknown): boolean {
  if (!isObject(value)) return false;

  try {
    return capturedReflectApply(capturedWeakSetHas, conditionalConflictErrors, [value]);
  } catch {
    return false;
  }
}

/** @internal Creates the rotation-only writer over one already-active direct transaction. */
export function createMySqlIdentitySessionRefreshRotatedWriter(
  context: IdentitySessionRefreshRotatedPersistenceMySqlContext,
  controller: IdentitySessionRefreshWorkflowController,
): RotatedWriter {
  try {
    const state = capturedFreeze({
      controller,
      executeStatement: createExecuteStatementOperation(context),
    });

    return new MySqlIdentitySessionRefreshRotatedWriterRuntime(
      WRITER_CONSTRUCTION_CAPABILITY,
      state,
    );
  } catch {
    persistenceFailed();
  }
}
