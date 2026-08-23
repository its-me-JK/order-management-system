import { isProxy } from 'node:util/types';

import type { DatabaseRuntime } from '@oms/database';
import {
  createMySqlTransactionExecutor,
  type MySqlTransactionDirective,
  type MySqlTransactionExecutor,
  type MySqlTransactionExecutorOptions,
  type MySqlTransactionOutcome,
  type MySqlTransactionProgram,
  type MySqlTransactionProgramContext,
} from '@oms/database/mysql-transaction';
import { getPrismaClient } from '@oms/database/prisma';

import {
  activateIdentitySessionRefreshCommand,
  admitIdentitySessionRefreshCommand,
  closeIdentitySessionRefreshCommand,
  runIdentitySessionRefreshCommand,
  type IdentitySessionRefreshCommand,
  type IdentitySessionRefreshStore,
} from '../../application/identity-session-refresh-command';
import type { IdentitySessionRefreshDiscovery } from '../../application/identity-session-refresh-discovery';
import {
  IDENTITY_SESSION_REFRESH_INDETERMINATE,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE,
  IdentitySessionRefreshExecutionFailedError,
  type IdentitySessionRefreshOutcome,
  type IdentitySessionRefreshUnitOfWork,
} from '../../application/identity-session-refresh-unit-of-work';
import {
  promoteIdentityTransactionPendingEvidence,
  revokeIdentityTransactionPendingEvidence,
  type IdentitySessionRefreshWorkflowController,
  type IdentityTransactionEvidence,
} from '../../application/identity-session-refresh-workflow';
import {
  inspectPrismaIdentitySessionRefreshDiscoveryAuthority,
  type IdentitySessionRefreshDiscoveryPrismaClient,
} from '../prisma/prisma-identity-session-refresh-discovery';
import {
  IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LOCK_PRESENTED_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LOCK_SESSION_FAMILY_MYSQL_STATEMENT,
  type IdentitySessionRefreshLockedLoadMySqlStatement,
} from './identity-session-refresh-locked-load.statements';
import type { IdentitySessionRefreshMySqlTransactionFailure } from './identity-session-refresh-mysql.contract';
import {
  IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
  type IdentitySessionRefreshReuseDetectedMySqlStatement,
} from './identity-session-refresh-reuse-detected.statements';
import { IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT } from './identity-session-refresh-rotation-authority.statement';
import {
  IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
  type IdentitySessionRefreshRotationMySqlStatement,
} from './identity-session-refresh-rotation.statements';
import { createMySqlIdentitySessionRefreshLockedLoader } from './mysql-identity-session-refresh-locked-loader';
import {
  createMySqlIdentitySessionRefreshReuseDetectedWriter,
  isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict,
} from './mysql-identity-session-refresh-reuse-detected.writer';
import {
  createMySqlIdentitySessionRefreshRotatedWriter,
  isMySqlIdentitySessionRefreshRotatedConditionalConflict,
} from './mysql-identity-session-refresh-rotated.writer';

const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsFrozen = Object.isFrozen;
const capturedIsProxy = isProxy;
const capturedOwnKeys = Reflect.ownKeys;
const capturedPromiseReject: (reason: unknown) => Promise<never> = Promise.reject.bind(Promise);
const capturedPromiseResolve: (value: unknown) => Promise<unknown> = Promise.resolve.bind(Promise);
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetAdd = Set.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapDelete = WeakMap.prototype.delete;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;
const inspectDiscoveryAuthority = inspectPrismaIdentitySessionRefreshDiscoveryAuthority;
const createTransactionExecutor = createMySqlTransactionExecutor;
const recoverPrismaClient = getPrismaClient;
const admitRefreshCommand = admitIdentitySessionRefreshCommand;
const activateRefreshCommand = activateIdentitySessionRefreshCommand;
const runRefreshCommand = runIdentitySessionRefreshCommand;
const closeRefreshCommand = closeIdentitySessionRefreshCommand;
const promotePendingEvidence = promoteIdentityTransactionPendingEvidence;
const revokePendingEvidence = revokeIdentityTransactionPendingEvidence;
const isRotatedConditionalConflict = isMySqlIdentitySessionRefreshRotatedConditionalConflict;
const isReuseConditionalConflict = isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict;

const PROGRAM_FAILURES = capturedFreeze([
  'credential-collision',
  'conditional-conflict',
  'unavailable',
  'execution-defect',
] as const);
const COMMITTED_OUTCOME_KEYS = capturedFreeze(['kind', 'result'] as const);
const NOT_COMMITTED_OUTCOME_KEYS = capturedFreeze(['kind', 'failure'] as const);
const INDETERMINATE_OUTCOME_KEYS = capturedFreeze(['kind'] as const);
const INTERNAL_INDETERMINATE_OUTCOME = capturedFreeze({ kind: 'indeterminate' as const });

type IdentitySessionRefreshProgramMySqlStatement =
  | IdentitySessionRefreshLockedLoadMySqlStatement
  | IdentitySessionRefreshRotationMySqlStatement
  | IdentitySessionRefreshReuseDetectedMySqlStatement;

const PROGRAM_STATEMENTS: readonly IdentitySessionRefreshProgramMySqlStatement[] = capturedFreeze([
  IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LOCK_SESSION_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LOCK_PRESENTED_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
]);

declare const identitySessionRefreshProgramInputBrand: unique symbol;

type IdentitySessionRefreshProgramInput = Readonly<{
  readonly [identitySessionRefreshProgramInputBrand]: true;
}>;

type IdentitySessionRefreshTransactionOutcome = MySqlTransactionOutcome<
  IdentityTransactionEvidence,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type IdentitySessionRefreshTransactionExecutor = MySqlTransactionExecutor<
  IdentitySessionRefreshProgramInput,
  IdentityTransactionEvidence,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type ProgramPhase = 'not-started' | 'running' | 'settled';

interface RefreshExecutionState {
  closeSucceeded: boolean | undefined;
  controller: IdentitySessionRefreshWorkflowController | undefined;
  databaseOutcome: IdentitySessionRefreshTransactionOutcome | undefined;
  evidence: IdentityTransactionEvidence | undefined;
  finalized: boolean;
  readonly input: IdentitySessionRefreshProgramInput;
  programPhase: ProgramPhase;
}

type ProgramContext = MySqlTransactionProgramContext<
  IdentityTransactionEvidence,
  IdentitySessionRefreshMySqlTransactionFailure,
  IdentitySessionRefreshProgramMySqlStatement
>;

type RefreshProgram = MySqlTransactionProgram<
  IdentitySessionRefreshProgramInput,
  IdentityTransactionEvidence,
  IdentitySessionRefreshMySqlTransactionFailure,
  IdentitySessionRefreshProgramMySqlStatement
>;

const executionStates = new WeakMap<object, RefreshExecutionState>();
// Deliberate fail-stop retention: if command close or evidence revocation cannot be
// proved, dropping these exact capabilities would erase unsettled authority. This
// set has no recovery/drain path yet; bounded observability and process recycling
// are required before refresh credential ingress may become public.
const quarantinedExecutionStates = new Set<RefreshExecutionState>();

class InvalidMySqlIdentitySessionRefreshUnitOfWorkError extends Error {
  public constructor() {
    super('Invalid MySQL Identity session refresh Unit of Work configuration');
    this.name = 'InvalidMySqlIdentitySessionRefreshUnitOfWorkError';
  }
}

function constructionFailed(): never {
  throw new InvalidMySqlIdentitySessionRefreshUnitOfWorkError();
}

function executionFailed(): never {
  throw new IdentitySessionRefreshExecutionFailedError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function readState(value: unknown): RefreshExecutionState {
  const state = isObject(value)
    ? (capturedReflectApply(capturedWeakMapGet, executionStates, [value]) as
        RefreshExecutionState | undefined)
    : undefined;

  if (state === undefined || state.input !== value || state.finalized) executionFailed();
  return state;
}

function setState(input: IdentitySessionRefreshProgramInput, state: RefreshExecutionState): void {
  capturedReflectApply(capturedWeakMapSet, executionStates, [input, state]);
}

function deleteState(input: IdentitySessionRefreshProgramInput): void {
  capturedReflectApply(capturedWeakMapDelete, executionStates, [input]);
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
    executionFailed();
  }

  return descriptor.value;
}

function readTransactionOutcome(
  value: unknown,
): IdentitySessionRefreshTransactionOutcome | undefined {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      capturedGetPrototypeOf(value) !== objectPrototype ||
      !capturedIsFrozen(value)
    ) {
      return undefined;
    }

    const kind = readFrozenDataProperty(value, 'kind');
    const keys = capturedOwnKeys(value);

    if (kind === 'committed' && hasExactStringKeys(keys, COMMITTED_OUTCOME_KEYS)) {
      readFrozenDataProperty(value, 'result');
      return value as IdentitySessionRefreshTransactionOutcome;
    }

    if (kind === 'indeterminate' && hasExactStringKeys(keys, INDETERMINATE_OUTCOME_KEYS)) {
      return value as IdentitySessionRefreshTransactionOutcome;
    }

    if (kind !== 'not-committed' || !hasExactStringKeys(keys, NOT_COMMITTED_OUTCOME_KEYS)) {
      return undefined;
    }

    const failure = readFrozenDataProperty(value, 'failure');

    return failure === 'credential-collision' ||
      failure === 'conditional-conflict' ||
      failure === 'unavailable' ||
      failure === 'execution-defect'
      ? (value as IdentitySessionRefreshTransactionOutcome)
      : undefined;
  } catch {
    return undefined;
  }
}

function createStore(
  client: IdentitySessionRefreshDiscoveryPrismaClient,
  discovery: IdentitySessionRefreshDiscovery,
  context: ProgramContext,
  controller: IdentitySessionRefreshWorkflowController,
): IdentitySessionRefreshStore {
  const loader = createMySqlIdentitySessionRefreshLockedLoader(
    client,
    context,
    discovery,
    controller,
  );
  const rotatedWriter = createMySqlIdentitySessionRefreshRotatedWriter(context, controller);
  const reuseWriter = createMySqlIdentitySessionRefreshReuseDetectedWriter(context, controller);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked only with the captured authentic receiver.
  const loadForUpdate = loader.loadForUpdate;
  const persistRotated = rotatedWriter.persistRotated;
  const persistReuseDetected = reuseWriter.persistReuseDetected;

  return capturedFreeze({
    loadForUpdate: (...arguments_: Parameters<typeof loadForUpdate>) =>
      capturedReflectApply(loadForUpdate, loader, arguments_),
    persistReuseDetected: (...arguments_: Parameters<typeof persistReuseDetected>) =>
      capturedReflectApply(persistReuseDetected, reuseWriter, arguments_),
    persistRotated: (...arguments_: Parameters<typeof persistRotated>) =>
      capturedReflectApply(persistRotated, rotatedWriter, arguments_),
  });
}

async function runProgram(
  client: IdentitySessionRefreshDiscoveryPrismaClient,
  discovery: IdentitySessionRefreshDiscovery,
  context: ProgramContext,
  input: IdentitySessionRefreshProgramInput,
): Promise<
  MySqlTransactionDirective<
    IdentityTransactionEvidence,
    IdentitySessionRefreshMySqlTransactionFailure
  >
> {
  const state = readState(input);

  if (state.programPhase !== 'not-started' || state.controller === undefined) executionFailed();
  state.programPhase = 'running';

  try {
    const transaction = activateRefreshCommand(state.controller, context.writerTime);
    const store = createStore(client, discovery, context, state.controller);
    const evidence = await runRefreshCommand(state.controller, transaction, store);

    if (state.evidence !== undefined) executionFailed();
    state.evidence = evidence;
    return context.requestCommit(evidence);
  } catch (error: unknown) {
    if (isRotatedConditionalConflict(error) || isReuseConditionalConflict(error)) {
      return context.requestRollback('conditional-conflict');
    }

    executionFailed();
  }
}

function closeProgramSide(state: RefreshExecutionState): boolean {
  const controller = state.controller;
  let closed = false;

  if (state.programPhase === 'settled' || controller === undefined) return false;

  try {
    closeRefreshCommand(controller);
    closed = true;
  } catch {
    // The readiness marker must still latch so the outer execution cannot wait forever.
  }

  state.closeSucceeded = closed;
  state.programPhase = 'settled';
  return closed;
}

function clearExecutionState(state: RefreshExecutionState): void {
  if (state.finalized) return;

  state.finalized = true;
  deleteState(state.input);
  state.controller = undefined;
  state.databaseOutcome = undefined;
  state.evidence = undefined;
}

function quarantineExecutionState(state: RefreshExecutionState): void {
  if (state.finalized) return;

  state.finalized = true;
  deleteState(state.input);
  capturedReflectApply(capturedSetAdd, quarantinedExecutionStates, [state]);
}

function revokeExecutionEvidence(state: RefreshExecutionState): boolean {
  const controller = state.controller;
  const evidence = state.evidence;

  if (evidence === undefined) return true;
  if (controller === undefined) return false;
  return revokePendingEvidence(controller, evidence);
}

function finishAfterRevocation(state: RefreshExecutionState): boolean {
  const cleanupSucceeded = state.closeSucceeded === true && revokeExecutionEvidence(state);

  if (cleanupSucceeded) {
    clearExecutionState(state);
  } else {
    quarantineExecutionState(state);
  }

  return cleanupSucceeded;
}

function finalizeIndeterminate(state: RefreshExecutionState): void {
  if (state.finalized || state.programPhase !== 'settled') return;

  finishAfterRevocation(state);
}

function observeProgramSettlement(
  this: undefined,
  input: IdentitySessionRefreshProgramInput,
): undefined {
  const state = readState(input);

  if (state.programPhase !== 'running') executionFailed();
  const closed = closeProgramSide(state);

  if (state.databaseOutcome?.kind === 'indeterminate') finalizeIndeterminate(state);
  if (!closed) executionFailed();
  return undefined;
}

function createProgram(
  client: IdentitySessionRefreshDiscoveryPrismaClient,
  discovery: IdentitySessionRefreshDiscovery,
): RefreshProgram {
  return capturedFreeze({
    defectFailure: 'execution-defect' as const,
    failures: PROGRAM_FAILURES,
    observeProgramSettlement,
    run: (
      context: ProgramContext,
      input: IdentitySessionRefreshProgramInput,
    ): Promise<
      MySqlTransactionDirective<
        IdentityTransactionEvidence,
        IdentitySessionRefreshMySqlTransactionFailure
      >
    > => runProgram(client, discovery, context, input),
    statements: PROGRAM_STATEMENTS,
    unavailableFailure: 'unavailable' as const,
  });
}

function finalizeCommitted(
  state: RefreshExecutionState,
  outcome: Extract<IdentitySessionRefreshTransactionOutcome, Readonly<{ kind: 'committed' }>>,
): IdentitySessionRefreshOutcome {
  const controller = state.controller;
  const evidence = state.evidence;

  if (
    state.closeSucceeded === true &&
    controller !== undefined &&
    evidence !== undefined &&
    outcome.result === evidence
  ) {
    const completion = promotePendingEvidence(controller, evidence);

    if (completion !== undefined) {
      clearExecutionState(state);
      return completion;
    }
  }

  finishAfterRevocation(state);
  return IDENTITY_SESSION_REFRESH_INDETERMINATE;
}

function finalizeNotCommitted(
  state: RefreshExecutionState,
  outcome: Extract<IdentitySessionRefreshTransactionOutcome, Readonly<{ kind: 'not-committed' }>>,
): IdentitySessionRefreshOutcome {
  const cleanupSucceeded = finishAfterRevocation(state);

  if (!cleanupSucceeded || outcome.failure === 'execution-defect') {
    executionFailed();
  }

  switch (outcome.failure) {
    case 'credential-collision':
      return IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION;
    case 'conditional-conflict':
      return IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT;
    case 'unavailable':
      return IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE;
  }
}

function completeDatabaseOutcome(
  state: RefreshExecutionState,
  value: unknown,
): IdentitySessionRefreshOutcome {
  let outcome = readTransactionOutcome(value) ?? INTERNAL_INDETERMINATE_OUTCOME;

  if (state.databaseOutcome !== undefined) outcome = INTERNAL_INDETERMINATE_OUTCOME;
  state.databaseOutcome = outcome;

  if (state.programPhase === 'not-started') closeProgramSide(state);

  if (outcome.kind === 'indeterminate') {
    finalizeIndeterminate(state);
    return IDENTITY_SESSION_REFRESH_INDETERMINATE;
  }

  if (state.programPhase !== 'settled') {
    state.databaseOutcome = INTERNAL_INDETERMINATE_OUTCOME;
    return IDENTITY_SESSION_REFRESH_INDETERMINATE;
  }

  return outcome.kind === 'committed'
    ? finalizeCommitted(state, outcome)
    : finalizeNotCommitted(state, outcome);
}

function executeRefreshCommand(
  executor: IdentitySessionRefreshTransactionExecutor,
  execute: IdentitySessionRefreshTransactionExecutor['execute'],
  command: IdentitySessionRefreshCommand,
): Promise<IdentitySessionRefreshOutcome> {
  let controller: IdentitySessionRefreshWorkflowController;

  try {
    controller = admitRefreshCommand(command).controller;
  } catch {
    return capturedPromiseReject(new IdentitySessionRefreshExecutionFailedError());
  }

  const input = capturedFreeze({}) as IdentitySessionRefreshProgramInput;
  const state: RefreshExecutionState = {
    closeSucceeded: undefined,
    controller,
    databaseOutcome: undefined,
    evidence: undefined,
    finalized: false,
    input,
    programPhase: 'not-started',
  };

  setState(input, state);
  let operation: unknown;

  try {
    operation = capturedReflectApply(execute, executor, [input]);
  } catch {
    return capturedPromiseResolve(INTERNAL_INDETERMINATE_OUTCOME).then((outcome) =>
      completeDatabaseOutcome(state, outcome),
    );
  }

  return capturedPromiseResolve(operation).then(
    (outcome) => completeDatabaseOutcome(state, outcome),
    () => completeDatabaseOutcome(state, INTERNAL_INDETERMINATE_OUTCOME),
  );
}

/**
 * Creates the package-internal direct-MySQL implementation of the refresh transaction port.
 * The discovery must be paired with the Prisma client owned by the same database runtime.
 */
export function createMySqlIdentitySessionRefreshUnitOfWork(
  runtime: DatabaseRuntime,
  discovery: IdentitySessionRefreshDiscovery,
  options: MySqlTransactionExecutorOptions,
): IdentitySessionRefreshUnitOfWork {
  try {
    const client = recoverPrismaClient(runtime);
    inspectDiscoveryAuthority(discovery, client);
    const executor = createTransactionExecutor(runtime, createProgram(client, discovery), options);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked only with the captured authentic executor receiver.
    const execute = executor.execute;

    return capturedFreeze({
      execute: (command: IdentitySessionRefreshCommand): Promise<IdentitySessionRefreshOutcome> =>
        executeRefreshCommand(executor, execute, command),
    });
  } catch {
    constructionFailed();
  }
}

capturedFreeze(InvalidMySqlIdentitySessionRefreshUnitOfWorkError.prototype);
capturedFreeze(InvalidMySqlIdentitySessionRefreshUnitOfWorkError);
