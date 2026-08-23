import { isProxy } from 'node:util/types';

import type {
  MySqlTransactionStatementParameters,
  MySqlTransactionStatementResult,
} from '@oms/database/mysql-transaction';

import type {
  IdentitySessionRefreshReuseDetectedStoreInput,
  IdentitySessionRefreshStore,
} from '../../application/identity-session-refresh-command';
import {
  beginIdentitySessionRefreshReusePersistence,
  completeIdentitySessionRefreshReusePersistence,
  failIdentitySessionRefreshPersistence,
  inspectIdentitySessionRefreshReusePersistence,
  type IdentitySessionRefreshReusePersistenceAction,
  type IdentitySessionRefreshWorkflowController,
} from '../../application/identity-session-refresh-workflow';
import { IdentityRefreshCredential } from '../../domain/identity-refresh-credential';
import { IdentitySessionFamily } from '../../domain/identity-session-family';
import {
  IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
  type IdentitySessionRefreshReuseDetectedMySqlStatement,
} from './identity-session-refresh-reuse-detected.statements';

const STORE_INPUT_KEYS = Object.freeze(['decision', 'securityEventId'] as const);
const STATEMENT_RESULT_KEYS = Object.freeze(['kind'] as const);
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
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakSetAdd = WeakSet.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakSetHas = WeakSet.prototype.has;
// eslint-disable-next-line @typescript-eslint/unbound-method
const sessionFamilySnapshot = IdentitySessionFamily.prototype.toSnapshot;
// eslint-disable-next-line @typescript-eslint/unbound-method
const refreshCredentialSnapshot = IdentityRefreshCredential.prototype.toSnapshot;

type ExecuteStatementOperation =
  IdentitySessionRefreshReuseDetectedPersistenceMySqlContext['executeStatement'];
type ReuseDetectedWriter = Pick<IdentitySessionRefreshStore, 'persistReuseDetected'>;
type WriterStoreInput = Readonly<{
  decision: IdentitySessionRefreshReuseDetectedStoreInput['decision'];
  securityEventId: IdentitySessionRefreshReuseDetectedStoreInput['securityEventId'];
}>;
type ReusePersistenceMaterial = Readonly<{
  updateParameters: MySqlTransactionStatementParameters<
    typeof IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT
  >;
  eventParameters: MySqlTransactionStatementParameters<
    typeof IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT
  >;
}>;
type WriterState = Readonly<{
  controller: IdentitySessionRefreshWorkflowController;
  executeStatement: ExecuteStatementOperation;
}>;

/** The writer receives neither transaction settlement nor writer-time authority. */
export interface IdentitySessionRefreshReuseDetectedPersistenceMySqlContext {
  executeStatement<Statement extends IdentitySessionRefreshReuseDetectedMySqlStatement>(
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>>;
}

class IdentitySessionRefreshReuseDetectedPersistenceError extends Error {
  public constructor() {
    super('Identity session refresh reuse persistence failed');
    this.name = 'IdentitySessionRefreshReuseDetectedPersistenceError';
  }
}

class IdentitySessionRefreshReuseDetectedConditionalConflictError extends Error {
  public constructor(capability: object) {
    if (capability !== CONDITIONAL_CONFLICT_CONSTRUCTION_CAPABILITY) persistenceFailed();
    super('Identity session refresh reuse persistence encountered a conditional conflict');
    this.name = 'IdentitySessionRefreshReuseDetectedConditionalConflictError';
  }
}

const writerStates = new WeakMap<object, WriterState>();
const conditionalConflictErrors = new WeakSet<object>();

function persistenceFailed(): never {
  throw new IdentitySessionRefreshReuseDetectedPersistenceError();
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

  return <Statement extends IdentitySessionRefreshReuseDetectedMySqlStatement>(
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>> => {
    const result: unknown = capturedReflectApply(executeStatement, value, [statement, parameters]);

    return capturedPromiseResolve(result) as Promise<MySqlTransactionStatementResult<Statement>>;
  };
}

function readStatementResultKind(value: unknown): 'changed' | 'no-match' | 'malformed' {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== objectPrototype ||
      !capturedIsFrozen(value) ||
      !hasExactStringKeys(capturedOwnKeys(value), STATEMENT_RESULT_KEYS)
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

function extractPersistenceMaterial(
  controller: IdentitySessionRefreshWorkflowController,
  action: IdentitySessionRefreshReusePersistenceAction,
): ReusePersistenceMaterial {
  const plan = inspectIdentitySessionRefreshReusePersistence(controller, action);
  const result = plan.result;
  const basis = result.basis;
  const family = capturedReflectApply(sessionFamilySnapshot, result.sessionFamily, []);
  const credential = capturedReflectApply(
    refreshCredentialSnapshot,
    result.reusedRefreshCredential,
    [],
  );
  const fact = result.facts[0];

  if (
    family.id !== basis.sessionId ||
    family.accountId !== basis.accountId ||
    family.version !== basis.sessionFamilyVersion + 1 ||
    family.revokedAt === null ||
    family.closedReason !== 'REFRESH_REUSE_DETECTED' ||
    credential.id !== basis.presentedRefreshCredentialId ||
    credential.sessionId !== basis.sessionId ||
    credential.sequence !== basis.presentedRefreshCredentialSequence ||
    credential.consumedAt === null ||
    credential.successorId === null ||
    fact.accountId !== basis.accountId ||
    fact.sessionId !== basis.sessionId ||
    fact.version !== family.version ||
    fact.occurredAt !== family.revokedAt
  ) {
    persistenceFailed();
  }

  return capturedFreeze({
    updateParameters: capturedFreeze([
      family.version,
      family.revokedAt,
      basis.sessionId,
      basis.accountId,
      basis.sessionFamilyVersion,
      basis.accountVersion,
      basis.presentedRefreshCredentialId,
      basis.presentedRefreshCredentialSequence,
    ] as const),
    eventParameters: capturedFreeze([
      plan.securityEventId,
      basis.accountId,
      basis.sessionId,
      fact.occurredAt,
    ] as const),
  });
}

function failActionBestEffort(
  state: WriterState,
  action: IdentitySessionRefreshReusePersistenceAction,
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
  action: IdentitySessionRefreshReusePersistenceAction,
): never {
  failActionBestEffort(state, action);
  persistenceFailed();
}

function conditionalConflictAfterAction(
  state: WriterState,
  action: IdentitySessionRefreshReusePersistenceAction,
): never {
  if (!failActionBestEffort(state, action)) persistenceFailed();
  const error = new IdentitySessionRefreshReuseDetectedConditionalConflictError(
    CONDITIONAL_CONFLICT_CONSTRUCTION_CAPABILITY,
  );

  capturedReflectApply(capturedWeakSetAdd, conditionalConflictErrors, [error]);
  capturedFreeze(error);
  throw error;
}

async function executeStatement<
  Statement extends IdentitySessionRefreshReuseDetectedMySqlStatement,
>(
  state: WriterState,
  action: IdentitySessionRefreshReusePersistenceAction,
  statement: Statement,
  parameters: MySqlTransactionStatementParameters<Statement>,
): Promise<MySqlTransactionStatementResult<Statement>> {
  try {
    return await state.executeStatement(statement, parameters);
  } catch {
    failAfterAction(state, action);
  }
}

class MySqlIdentitySessionRefreshReuseDetectedWriterRuntime implements ReuseDetectedWriter {
  public constructor(capability: object, state: WriterState) {
    if (capability !== WRITER_CONSTRUCTION_CAPABILITY) persistenceFailed();
    capturedReflectApply(capturedWeakMapSet, writerStates, [this, state]);
    capturedFreeze(this);
  }

  public async persistReuseDetected(
    scope: Parameters<ReuseDetectedWriter['persistReuseDetected']>[0],
    inputValue: Parameters<ReuseDetectedWriter['persistReuseDetected']>[1],
  ): ReturnType<ReuseDetectedWriter['persistReuseDetected']> {
    const state = capturedReflectApply(capturedWeakMapGet, writerStates, [this]) as
      WriterState | undefined;

    if (state === undefined) persistenceFailed();
    const input = readStoreInput(inputValue);
    const action = beginIdentitySessionRefreshReusePersistence(
      state.controller,
      scope,
      input.decision,
      input.securityEventId,
    );
    let material: ReusePersistenceMaterial;

    try {
      material = extractPersistenceMaterial(state.controller, action);
    } catch {
      failAfterAction(state, action);
    }

    const updateResult = await executeStatement(
      state,
      action,
      IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
      material.updateParameters,
    );
    let updateKind: ReturnType<typeof readStatementResultKind>;

    try {
      updateKind = readStatementResultKind(updateResult);
    } catch {
      failAfterAction(state, action);
    }

    if (updateKind === 'no-match') conditionalConflictAfterAction(state, action);
    if (updateKind !== 'changed') failAfterAction(state, action);
    const eventResult = await executeStatement(
      state,
      action,
      IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
      material.eventParameters,
    );

    try {
      if (readStatementResultKind(eventResult) !== 'changed') failAfterAction(state, action);
      return completeIdentitySessionRefreshReusePersistence(state.controller, action);
    } catch {
      failAfterAction(state, action);
    }
  }
}

capturedFreeze(IdentitySessionRefreshReuseDetectedPersistenceError.prototype);
capturedFreeze(IdentitySessionRefreshReuseDetectedPersistenceError);
capturedFreeze(IdentitySessionRefreshReuseDetectedConditionalConflictError.prototype);
capturedFreeze(IdentitySessionRefreshReuseDetectedConditionalConflictError);
capturedFreeze(MySqlIdentitySessionRefreshReuseDetectedWriterRuntime.prototype);
capturedFreeze(MySqlIdentitySessionRefreshReuseDetectedWriterRuntime);

/** @internal Recognizes only the writer-created zero-row conditional-conflict signal. */
export function isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(
  value: unknown,
): boolean {
  if (!isObject(value)) return false;

  try {
    return capturedReflectApply(capturedWeakSetHas, conditionalConflictErrors, [value]);
  } catch {
    return false;
  }
}

/** @internal Creates the reuse-only writer over one already-active direct transaction. */
export function createMySqlIdentitySessionRefreshReuseDetectedWriter(
  context: IdentitySessionRefreshReuseDetectedPersistenceMySqlContext,
  controller: IdentitySessionRefreshWorkflowController,
): ReuseDetectedWriter {
  try {
    const state = capturedFreeze({
      controller,
      executeStatement: createExecuteStatementOperation(context),
    });

    return new MySqlIdentitySessionRefreshReuseDetectedWriterRuntime(
      WRITER_CONSTRUCTION_CAPABILITY,
      state,
    );
  } catch {
    persistenceFailed();
  }
}
