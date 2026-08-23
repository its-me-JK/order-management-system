import { performance } from 'node:perf_hooks';
import { isPromise } from 'node:util/types';

import type {
  ManagedMariaDbAllocatedConnection,
  ManagedMariaDbConnectionLease,
  ManagedMariaDbConnectionLeaseOwner,
} from './managed-mariadb-connection-lease.owner';
import { getRuntimeMariaDbConnectionLeaseOwner } from '../prisma-database.runtime';
import type { DatabaseRuntime } from '../database.contract';
import type {
  AnyMySqlTransactionStatement,
  MySqlTransactionDirective,
  MySqlTransactionExecutor,
  MySqlTransactionExecutorOptions,
  MySqlTransactionOutcome,
  MySqlTransactionProgram,
  MySqlTransactionProgramContext,
  MySqlTransactionStatementParameters,
  MySqlTransactionStatementResult,
} from '../mysql-transaction.contract';
import { getMySqlTransactionStatementRegistration } from '../mysql-transaction.statement';
import {
  copyMySqlTransactionParameters,
  InvalidMySqlTransactionParametersError,
} from './mysql-transaction-parameter.owner';

const MINIMUM_TRANSACTION_TIMEOUT_MILLISECONDS = 1_000;
const MAXIMUM_TRANSACTION_TIMEOUT_MILLISECONDS = 10_000;
const MAX_FAILURES = 32;
const MAX_FAILURE_LENGTH = 64;
const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const capturedIsPromise = isPromise;
const capturedPromiseConstructor = Promise;
const capturedPromisePrototype = Promise.prototype;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedPromiseThen = Promise.prototype.then;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked with its authentic receiver.
const capturedPerformanceNow = performance.now;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedMapGet = Map.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetAdd = Set.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetHas = Set.prototype.has;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapDelete = WeakMap.prototype.delete;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;

const PROGRAM_KEYS = capturedFreeze([
  'statements',
  'failures',
  'unavailableFailure',
  'defectFailure',
  'observeProgramSettlement',
  'run',
] as const);
const REQUIRED_PROGRAM_KEY_COUNT = PROGRAM_KEYS.length - 1;
const OPTIONS_KEYS = capturedFreeze(['timeoutMilliseconds'] as const);
const promiseSpeciesDescriptor = capturedGetOwnPropertyDescriptor(
  capturedPromiseConstructor,
  Symbol.species,
);

if (promiseSpeciesDescriptor?.get === undefined) {
  throw new TypeError('Expected the intrinsic Promise species getter');
}

// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured only for descriptor identity comparison.
const capturedPromiseSpeciesGetter = promiseSpeciesDescriptor.get;

const SET_UTC = "SET SESSION time_zone = '+00:00'";
const SET_READ_COMMITTED = 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED';
const START_TRANSACTION = 'START TRANSACTION READ WRITE';
const READ_TRANSACTION_CHARACTERISTICS = `
  SELECT
    @@SESSION.time_zone AS time_zone,
    @@SESSION.transaction_isolation AS transaction_isolation
`;
const COMMIT_TRANSACTION = 'COMMIT';
const ROLLBACK_TRANSACTION = 'ROLLBACK';

type ControlPhase =
  | 'pre-begin'
  | 'begin-requested'
  | 'active'
  | 'rollback-requested'
  | 'commit-requested'
  | 'rolled-back'
  | 'committed'
  | 'indeterminate';

type SessionStatus = 'not-created' | 'active' | 'sealed';

type OperationObservation<Value> =
  | Readonly<{ kind: 'fulfilled'; value: Value }>
  | Readonly<{ kind: 'rejected' }>
  | Readonly<{ kind: 'deadline' }>;

type ProgramSettlementObserver<Input> = (this: undefined, input: Input) => unknown;

interface CapturedProgram<
  Input,
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
> {
  readonly defectFailure: Failure;
  readonly failures: ReadonlySet<Failure>;
  readonly observeProgramSettlement: ProgramSettlementObserver<Input> | undefined;
  readonly run: MySqlTransactionProgram<Input, CommitResult, Failure, Statements>['run'];
  readonly statements: ReadonlySet<object>;
  readonly unavailableFailure: Failure;
}

interface DirectiveRegistration<CommitResult, Failure extends string> {
  readonly authority: object;
  readonly directive: MySqlTransactionDirective<CommitResult, Failure>;
  readonly disposition: 'commit' | 'rollback';
  outcome: MySqlTransactionOutcome<CommitResult, Failure> | undefined;
}

interface ExecutionState<CommitResult, Failure extends string> {
  readonly authority: object;
  readonly connection: ManagedMariaDbAllocatedConnection;
  readonly lease: ManagedMariaDbConnectionLease;
  readonly owner: ManagedMariaDbConnectionLeaseOwner<unknown>;
  activeOperation: Promise<unknown> | undefined;
  directive: MySqlTransactionDirective<CommitResult, Failure> | undefined;
  failure: Failure | undefined;
  leaseSettled: boolean;
  phase: ControlPhase;
  programSettlementObservation: Promise<void> | undefined;
  programSettlementObserved: boolean;
  sessionStatus: SessionStatus;
}

type ManagedMySqlTransactionExecutorFactory = <
  Input,
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
>(
  constructionAuthority: object,
  owner: ManagedMariaDbConnectionLeaseOwner<unknown>,
  program: MySqlTransactionProgram<Input, CommitResult, Failure, Statements>,
  options: MySqlTransactionExecutorOptions,
) => MySqlTransactionExecutor<Input, CommitResult, Failure>;

interface TransactionCharacteristicsRow {
  readonly transaction_isolation: unknown;
  readonly time_zone: unknown;
}

const directiveRegistrations = new WeakMap<object, DirectiveRegistration<unknown, string>>();
const EXECUTOR_CONSTRUCTION_AUTHORITY = capturedFreeze({});
let constructManagedMySqlTransactionExecutor: ManagedMySqlTransactionExecutorFactory | undefined;
const DEADLINE_OBSERVATION = capturedFreeze({ kind: 'deadline' as const });
const REJECTED_OBSERVATION = capturedFreeze({ kind: 'rejected' as const });
const INDETERMINATE_OUTCOME = capturedFreeze({ kind: 'indeterminate' as const });
const SETTLED_PROGRAM_OBSERVATION = Promise.resolve();
const ignorePromiseSettlement = (): undefined => undefined;

class InvalidMySqlTransactionExecutorError extends Error {
  public constructor() {
    super('Invalid MySQL transaction executor configuration');
    this.name = 'InvalidMySqlTransactionExecutorError';
  }
}

class InvalidMySqlTransactionProgramError extends Error {
  public constructor() {
    super('Invalid MySQL transaction program transition');
    this.name = 'InvalidMySqlTransactionProgramError';
  }
}

class MySqlTransactionStatementExecutionError extends Error {
  public constructor() {
    super('MySQL transaction statement failed');
    this.name = 'MySqlTransactionStatementExecutionError';
  }
}

class TransactionDeadline {
  readonly #expiresAt: number;
  readonly #expiration: Promise<Readonly<{ kind: 'deadline' }>>;
  readonly #onExpire: () => void;
  readonly #resolveExpiration: (value: Readonly<{ kind: 'deadline' }>) => void;
  #expired = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(timeoutMilliseconds: number, onExpire: () => void) {
    let resolveExpiration: ((value: Readonly<{ kind: 'deadline' }>) => void) | undefined;

    this.#expiresAt = monotonicNow() + timeoutMilliseconds;
    this.#onExpire = onExpire;
    this.#expiration = new Promise((resolve): void => {
      resolveExpiration = resolve;
    });
    if (resolveExpiration === undefined) invalidExecutor();
    this.#resolveExpiration = resolveExpiration;
    this.#timer = setTimeout((): void => {
      this.#expire();
    }, timeoutMilliseconds);
  }

  public hasExpired(): boolean {
    if (!this.#expired && monotonicNow() >= this.#expiresAt) this.#expire();
    return this.#expired;
  }

  public async observe<Value>(operation: Promise<Value>): Promise<OperationObservation<Value>> {
    if (this.hasExpired()) return DEADLINE_OBSERVATION;

    const observation = operation.then<OperationObservation<Value>, OperationObservation<Value>>(
      (value) =>
        this.hasExpired()
          ? DEADLINE_OBSERVATION
          : capturedFreeze({ kind: 'fulfilled' as const, value }),
      () => (this.hasExpired() ? DEADLINE_OBSERVATION : REJECTED_OBSERVATION),
    );

    return Promise.race([observation, this.#expiration]);
  }

  #expire(): void {
    if (this.#expired) return;

    this.#expired = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    try {
      this.#onExpire();
    } catch {
      // Quarantine failures never expose their provider cause.
    }

    this.#resolveExpiration(DEADLINE_OBSERVATION);
  }

  public close(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }
}

function monotonicNow(): number {
  return capturedReflectApply(capturedPerformanceNow, performance, []);
}

function invalidExecutor(): never {
  throw new InvalidMySqlTransactionExecutorError();
}

function invalidProgram(): never {
  throw new InvalidMySqlTransactionProgramError();
}

function mapGet<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value | undefined {
  const value: unknown = capturedReflectApply(capturedMapGet, map, [key]);
  return value as Value | undefined;
}

function setAdd<Value>(set: Set<Value>, value: Value): void {
  capturedReflectApply(capturedSetAdd, set, [value]);
}

function setHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  return capturedReflectApply(capturedSetHas, set, [value]);
}

function weakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  capturedReflectApply(capturedWeakMapSet, map, [key, value]);
}

function containOrdinaryPromiseSettlement(value: unknown): void {
  try {
    if (
      !capturedIsPromise(value) ||
      capturedGetPrototypeOf(value) !== capturedPromisePrototype ||
      capturedGetOwnPropertyDescriptor(value, 'constructor') !== undefined
    ) {
      return;
    }

    const constructorDescriptor = capturedGetOwnPropertyDescriptor(
      capturedPromisePrototype,
      'constructor',
    );
    const speciesDescriptor = capturedGetOwnPropertyDescriptor(
      capturedPromiseConstructor,
      Symbol.species,
    );

    if (
      constructorDescriptor === undefined ||
      !capturedHasOwn(constructorDescriptor, 'value') ||
      constructorDescriptor.value !== capturedPromiseConstructor ||
      speciesDescriptor?.get !== capturedPromiseSpeciesGetter ||
      speciesDescriptor.set !== undefined ||
      capturedHasOwn(speciesDescriptor, 'value')
    ) {
      return;
    }

    void capturedReflectApply(capturedPromiseThen, value, [
      ignorePromiseSettlement,
      ignorePromiseSettlement,
    ]);
  } catch {
    // A hostile Promise subclass cannot affect the already selected fixed failure.
  }
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isPlainRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !capturedIsArray(value) &&
    capturedGetPrototypeOf(value) === objectPrototype
  );
}

function ownDataValue(value: object, key: PropertyKey): unknown {
  const descriptor = capturedGetOwnPropertyDescriptor(value, key);

  if (descriptor === undefined || !capturedHasOwn(descriptor, 'value')) invalidExecutor();

  return descriptor.value;
}

function readExactArray(value: unknown): readonly unknown[] {
  if (!capturedIsArray(value)) invalidExecutor();

  const keys = capturedOwnKeys(value);

  if (
    keys.length !== value.length + 1 ||
    !keys.includes('length') ||
    keys.some((key) => {
      if (key === 'length') return false;
      if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= value.length;
    })
  ) {
    invalidExecutor();
  }

  const copy: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    copy.push(ownDataValue(value, String(index)));
  }

  return copy;
}

function readOptions(value: unknown): number {
  if (!isPlainRecord(value)) invalidExecutor();

  const keys = capturedOwnKeys(value);

  if (keys.length !== OPTIONS_KEYS.length || keys.some((key) => key !== 'timeoutMilliseconds')) {
    invalidExecutor();
  }

  const timeoutMilliseconds = ownDataValue(value, 'timeoutMilliseconds');

  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    (timeoutMilliseconds as number) < MINIMUM_TRANSACTION_TIMEOUT_MILLISECONDS ||
    (timeoutMilliseconds as number) > MAXIMUM_TRANSACTION_TIMEOUT_MILLISECONDS
  ) {
    invalidExecutor();
  }

  return timeoutMilliseconds as number;
}

function readProgram<
  Input,
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
>(
  value: MySqlTransactionProgram<Input, CommitResult, Failure, Statements>,
): CapturedProgram<Input, CommitResult, Failure, Statements> {
  if (!isPlainRecord(value)) invalidExecutor();

  const keys = capturedOwnKeys(value);

  if (
    keys.length < REQUIRED_PROGRAM_KEY_COUNT ||
    keys.length > PROGRAM_KEYS.length ||
    keys.some(
      (key) => typeof key !== 'string' || !PROGRAM_KEYS.some((expected) => expected === key),
    )
  ) {
    invalidExecutor();
  }

  const statementValues = readExactArray(ownDataValue(value, 'statements'));
  const failureValues = readExactArray(ownDataValue(value, 'failures'));
  const unavailableFailure = ownDataValue(value, 'unavailableFailure');
  const defectFailure = ownDataValue(value, 'defectFailure');
  const hasProgramSettlementObserver = keys.includes('observeProgramSettlement');
  const observeProgramSettlement = hasProgramSettlementObserver
    ? ownDataValue(value, 'observeProgramSettlement')
    : undefined;
  const run = ownDataValue(value, 'run');

  if (
    statementValues.length === 0 ||
    failureValues.length === 0 ||
    failureValues.length > MAX_FAILURES ||
    typeof unavailableFailure !== 'string' ||
    typeof defectFailure !== 'string' ||
    unavailableFailure === defectFailure ||
    (hasProgramSettlementObserver && typeof observeProgramSettlement !== 'function') ||
    typeof run !== 'function'
  ) {
    invalidExecutor();
  }

  const failures = new Set<Failure>();

  for (const failure of failureValues) {
    if (
      typeof failure !== 'string' ||
      failure.length === 0 ||
      failure.length > MAX_FAILURE_LENGTH ||
      setHas(failures, failure as Failure)
    ) {
      invalidExecutor();
    }

    setAdd(failures, failure as Failure);
  }

  if (
    !setHas(failures, unavailableFailure as Failure) ||
    !setHas(failures, defectFailure as Failure)
  ) {
    invalidExecutor();
  }

  const statements = new Set<object>();

  for (const statement of statementValues) {
    const registration = getMySqlTransactionStatementRegistration(statement);

    if (setHas(statements, registration.statement)) invalidExecutor();

    // Indexing avoids mutable Array iterator authority in this allowlist validation path.
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (
      let failureIndex = 0;
      failureIndex < registration.duplicateKeyFailureValues.length;
      failureIndex += 1
    ) {
      const failure = registration.duplicateKeyFailureValues[failureIndex];

      if (failure === undefined) invalidExecutor();
      if (!setHas(failures, failure as Failure)) invalidExecutor();
    }

    setAdd(statements, registration.statement);
  }

  return {
    defectFailure: defectFailure as Failure,
    failures,
    observeProgramSettlement: observeProgramSettlement as
      ProgramSettlementObserver<Input> | undefined,
    run: run as MySqlTransactionProgram<Input, CommitResult, Failure, Statements>['run'],
    statements,
    unavailableFailure: unavailableFailure as Failure,
  };
}

function hasExpectedTransactionCharacteristics(value: unknown): boolean {
  try {
    if (!capturedIsArray(value) || value.length !== 1) return false;

    const row: unknown = value[0];

    if (!isPlainRecord(row)) return false;

    const keys = capturedOwnKeys(row);

    if (
      keys.length !== 2 ||
      !keys.includes('time_zone') ||
      !keys.includes('transaction_isolation')
    ) {
      return false;
    }

    const characteristics: TransactionCharacteristicsRow = {
      transaction_isolation: ownDataValue(row, 'transaction_isolation'),
      time_zone: ownDataValue(row, 'time_zone'),
    };

    return (
      characteristics.time_zone === '+00:00' &&
      characteristics.transaction_isolation === 'READ-COMMITTED'
    );
  } catch {
    return false;
  }
}

function ownDriverData(value: unknown, key: string): unknown {
  if (!isObject(value)) return undefined;

  const descriptor = capturedGetOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && capturedHasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function duplicateConstraintName(value: unknown): string | undefined {
  try {
    if (
      ownDriverData(value, 'errno') !== 1062 ||
      ownDriverData(value, 'code') !== 'ER_DUP_ENTRY' ||
      ownDriverData(value, 'sqlState') !== '23000'
    ) {
      return undefined;
    }

    const message = ownDriverData(value, 'sqlMessage');

    if (typeof message !== 'string' || message.length > 2_048) return undefined;

    const match = / for key ['`]([A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,2})['`]$/u.exec(
      message,
    );
    return match?.[1];
  } catch {
    return undefined;
  }
}

function deleteDirective(directive: object): void {
  capturedReflectApply(capturedWeakMapDelete, directiveRegistrations, [directive]);
}

function directiveRegistrationFor<CommitResult, Failure extends string>(
  directive: unknown,
): DirectiveRegistration<CommitResult, Failure> | undefined {
  if (!isObject(directive)) return undefined;

  return capturedReflectApply(capturedWeakMapGet, directiveRegistrations, [directive]) as
    DirectiveRegistration<CommitResult, Failure> | undefined;
}

/** @internal Database-owned exact-connection transaction state machine. */
class ManagedMySqlTransactionExecutor<
  Input,
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
> implements MySqlTransactionExecutor<Input, CommitResult, Failure> {
  readonly #defectOutcome: MySqlTransactionOutcome<CommitResult, Failure>;
  readonly #owner: ManagedMariaDbConnectionLeaseOwner<unknown>;
  readonly #program: CapturedProgram<Input, CommitResult, Failure, Statements>;
  readonly #timeoutMilliseconds: number;
  readonly #unavailableOutcome: MySqlTransactionOutcome<CommitResult, Failure>;

  static {
    constructManagedMySqlTransactionExecutor = <
      FactoryInput,
      FactoryCommitResult,
      FactoryFailure extends string,
      FactoryStatements extends AnyMySqlTransactionStatement<FactoryFailure>,
    >(
      constructionAuthority: object,
      owner: ManagedMariaDbConnectionLeaseOwner<unknown>,
      program: MySqlTransactionProgram<
        FactoryInput,
        FactoryCommitResult,
        FactoryFailure,
        FactoryStatements
      >,
      options: MySqlTransactionExecutorOptions,
    ): MySqlTransactionExecutor<FactoryInput, FactoryCommitResult, FactoryFailure> =>
      new ManagedMySqlTransactionExecutor(constructionAuthority, owner, program, options);
  }

  private constructor(
    constructionAuthority: object,
    owner: ManagedMariaDbConnectionLeaseOwner<unknown>,
    program: MySqlTransactionProgram<Input, CommitResult, Failure, Statements>,
    options: MySqlTransactionExecutorOptions,
  ) {
    if (
      constructionAuthority !== EXECUTOR_CONSTRUCTION_AUTHORITY ||
      new.target !== ManagedMySqlTransactionExecutor
    ) {
      invalidExecutor();
    }

    try {
      this.#owner = owner;
      this.#program = readProgram(program);
      this.#timeoutMilliseconds = readOptions(options);
      this.#unavailableOutcome = capturedFreeze({
        kind: 'not-committed',
        failure: this.#program.unavailableFailure,
      });
      this.#defectOutcome = capturedFreeze({
        kind: 'not-committed',
        failure: this.#program.defectFailure,
      });
    } catch {
      invalidExecutor();
    }
  }

  public execute(input: Input): Promise<MySqlTransactionOutcome<CommitResult, Failure>> {
    let acquisition: Promise<ManagedMariaDbConnectionLease>;

    try {
      acquisition = this.#owner.acquire();
    } catch {
      return Promise.resolve(this.#unavailableOutcome);
    }

    return this.#executeAcquired(input, acquisition);
  }

  async #executeAcquired(
    input: Input,
    acquisition: Promise<ManagedMariaDbConnectionLease>,
  ): Promise<MySqlTransactionOutcome<CommitResult, Failure>> {
    let lease: ManagedMariaDbConnectionLease;

    try {
      lease = await acquisition;
    } catch {
      return this.#unavailableOutcome;
    }

    let connection: ManagedMariaDbAllocatedConnection;

    try {
      connection = this.#owner.connectionFor(lease);
    } catch {
      try {
        this.#owner.destroy(lease);
      } catch {
        // The fixed unavailable outcome carries no lifecycle cause.
      }

      return this.#unavailableOutcome;
    }

    const state: ExecutionState<CommitResult, Failure> = {
      activeOperation: undefined,
      authority: capturedFreeze({}),
      connection,
      directive: undefined,
      failure: undefined,
      lease,
      leaseSettled: false,
      owner: this.#owner,
      phase: 'pre-begin',
      programSettlementObservation: undefined,
      programSettlementObserved: false,
      sessionStatus: 'not-created',
    };
    const deadline = new TransactionDeadline(this.#timeoutMilliseconds, (): void => {
      this.#expire(state);
    });

    try {
      if (!(await this.#controlSucceeded(state, deadline, SET_UTC))) {
        await this.#retire(state, deadline);
        return this.#unavailableOutcome;
      }

      if (!(await this.#controlSucceeded(state, deadline, SET_READ_COMMITTED))) {
        await this.#retire(state, deadline);
        return this.#unavailableOutcome;
      }

      state.phase = 'begin-requested';
      const begin = await this.#control(state, deadline, START_TRANSACTION);

      if (begin.kind !== 'fulfilled') {
        const retired = await this.#retire(state, deadline);

        if (retired) return this.#unavailableOutcome;

        state.phase = 'indeterminate';
        return INDETERMINATE_OUTCOME;
      }

      state.phase = 'active';
      const characteristics = await this.#control(
        state,
        deadline,
        READ_TRANSACTION_CHARACTERISTICS,
      );

      if (
        characteristics.kind !== 'fulfilled' ||
        !hasExpectedTransactionCharacteristics(characteristics.value)
      ) {
        return await this.#rollback(state, deadline, this.#unavailableOutcome);
      }

      return await this.#runProgram(state, deadline, input);
    } finally {
      state.sessionStatus = 'sealed';
      deadline.close();
    }
  }

  #expire(state: ExecutionState<CommitResult, Failure>): void {
    state.sessionStatus = 'sealed';

    if (state.leaseSettled) return;

    try {
      state.owner.destroy(state.lease);
    } catch {
      // The lease owner records terminal failure without leaking its cause.
    } finally {
      state.leaseSettled = true;
    }
  }

  async #control<Result = unknown>(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
    sql: string,
  ): Promise<OperationObservation<Result>> {
    if (deadline.hasExpired() || state.leaseSettled) return DEADLINE_OBSERVATION;

    let operation: Promise<Result>;

    try {
      operation = Promise.resolve(state.connection.query<Result>(sql));
    } catch {
      return REJECTED_OBSERVATION;
    }

    return deadline.observe(operation);
  }

  async #controlSucceeded(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
    sql: string,
  ): Promise<boolean> {
    const outcome = await this.#control(state, deadline, sql);
    return outcome.kind === 'fulfilled';
  }

  async #runProgram(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
    input: Input,
  ): Promise<MySqlTransactionOutcome<CommitResult, Failure>> {
    state.sessionStatus = 'active';
    const context = this.#createProgramContext(state, deadline);
    let operation: Promise<MySqlTransactionDirective<CommitResult, Failure>>;

    try {
      operation = Promise.resolve(
        capturedReflectApply(this.#program.run, undefined, [context, input]),
      );
    } catch {
      this.#poison(state, this.#program.defectFailure);
      operation = Promise.reject(new InvalidMySqlTransactionProgramError());
    }

    const settlement = operation.then<
      OperationObservation<MySqlTransactionDirective<CommitResult, Failure>>,
      OperationObservation<MySqlTransactionDirective<CommitResult, Failure>>
    >(
      (value) => {
        this.#sealProgramSettlement(state, input);
        return capturedFreeze({ kind: 'fulfilled' as const, value });
      },
      () => {
        this.#sealProgramSettlement(state, input);
        return REJECTED_OBSERVATION;
      },
    );
    const observedSettlement = await deadline.observe(settlement);
    const programOutcome =
      observedSettlement.kind === 'fulfilled' ? observedSettlement.value : DEADLINE_OBSERVATION;

    if (programOutcome.kind === 'deadline') {
      state.phase = 'indeterminate';
      this.#clearDirective(state);
      return INDETERMINATE_OUTCOME;
    }

    const programSettlementObservation = state.programSettlementObservation;

    if (programSettlementObservation === undefined) {
      this.#poison(state, this.#program.defectFailure);
    } else if ((await deadline.observe(programSettlementObservation)).kind === 'deadline') {
      state.phase = 'indeterminate';
      this.#clearDirective(state);
      return INDETERMINATE_OUTCOME;
    }

    let registration: DirectiveRegistration<CommitResult, Failure> | undefined;

    if (programOutcome.kind === 'fulfilled') {
      registration = directiveRegistrationFor<CommitResult, Failure>(programOutcome.value);

      if (
        registration?.authority !== state.authority ||
        registration.directive !== programOutcome.value ||
        state.directive !== programOutcome.value
      ) {
        registration = undefined;
        this.#poison(state, this.#program.defectFailure);
      }
    } else if (state.failure === undefined) {
      this.#poison(state, this.#program.defectFailure);
    }

    if (state.failure !== undefined) {
      const outcome = capturedFreeze({
        kind: 'not-committed' as const,
        failure: state.failure,
      });
      this.#clearDirective(state);
      return this.#rollback(state, deadline, outcome);
    }

    if (registration?.outcome === undefined) {
      this.#clearDirective(state);
      return this.#rollback(state, deadline, this.#defectOutcome);
    }

    const outcome = registration.outcome;
    const disposition = registration.disposition;
    registration.outcome = undefined;
    deleteDirective(registration.directive);
    state.directive = undefined;

    return disposition === 'commit'
      ? this.#commit(state, deadline, outcome)
      : this.#rollback(state, deadline, outcome);
  }

  #sealProgramSettlement(state: ExecutionState<CommitResult, Failure>, input: Input): void {
    state.sessionStatus = 'sealed';
    const activeOperation = state.activeOperation;

    if (activeOperation === undefined) {
      state.programSettlementObservation = SETTLED_PROGRAM_OBSERVATION;
      this.#observeProgramSettlement(state, input);
      return;
    }

    this.#poison(state, this.#program.defectFailure);
    const notify = (): void => {
      this.#observeProgramSettlement(state, input);
    };

    try {
      const observation: unknown = capturedReflectApply(capturedPromiseThen, activeOperation, [
        notify,
        notify,
      ]);

      if (!capturedIsPromise(observation)) {
        this.#poison(state, this.#program.defectFailure);
        return;
      }

      state.programSettlementObservation = observation as Promise<void>;
      containOrdinaryPromiseSettlement(observation);
    } catch {
      this.#poison(state, this.#program.defectFailure);
    }
  }

  #observeProgramSettlement(state: ExecutionState<CommitResult, Failure>, input: Input): void {
    if (state.programSettlementObserved) {
      this.#poison(state, this.#program.defectFailure);
      return;
    }

    state.programSettlementObserved = true;
    const observer = this.#program.observeProgramSettlement;

    if (observer === undefined) return;

    try {
      const result: unknown = capturedReflectApply(observer, undefined, [input]);

      if (result !== undefined) {
        containOrdinaryPromiseSettlement(result);
        this.#poison(state, this.#program.defectFailure);
      }
    } catch (error: unknown) {
      containOrdinaryPromiseSettlement(error);
      this.#poison(state, this.#program.defectFailure);
    }
  }

  #createProgramContext(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
  ): MySqlTransactionProgramContext<CommitResult, Failure, Statements> {
    return capturedFreeze({
      executeStatement: <Statement extends Statements>(
        statement: Statement,
        parameters: MySqlTransactionStatementParameters<Statement>,
      ): Promise<MySqlTransactionStatementResult<Statement>> =>
        this.#executeStatement(state, deadline, statement, parameters),
      requestCommit: (result: CommitResult): MySqlTransactionDirective<CommitResult, Failure> =>
        this.#requestDirective(state, 'commit', result),
      requestRollback: (failure: Failure): MySqlTransactionDirective<CommitResult, Failure> =>
        this.#requestDirective(state, 'rollback', failure),
    });
  }

  #executeStatement<Statement extends Statements>(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>> {
    if (
      deadline.hasExpired() ||
      state.sessionStatus !== 'active' ||
      state.phase !== 'active' ||
      state.directive !== undefined ||
      state.activeOperation !== undefined
    ) {
      this.#poison(state, this.#program.defectFailure);
      invalidProgram();
    }

    let registration: ReturnType<typeof getMySqlTransactionStatementRegistration>;

    try {
      registration = getMySqlTransactionStatementRegistration(statement);
    } catch {
      this.#poison(state, this.#program.defectFailure);
      invalidProgram();
    }

    if (!setHas(this.#program.statements, registration.statement)) {
      this.#poison(state, this.#program.defectFailure);
      invalidProgram();
    }

    let parametersOwner: ReturnType<typeof copyMySqlTransactionParameters>;

    try {
      parametersOwner = copyMySqlTransactionParameters(parameters, registration.parameterCount);
    } catch {
      this.#poison(state, this.#program.defectFailure);
      throw new InvalidMySqlTransactionParametersError();
    }

    if (deadline.hasExpired()) {
      parametersOwner.erase();
      this.#poison(state, this.#program.unavailableFailure);
      throw new MySqlTransactionStatementExecutionError();
    }

    let providerOperation: Promise<unknown>;
    let resolveActiveOperation: (() => void) | undefined;
    const activeOperation = new Promise<void>((resolve): void => {
      resolveActiveOperation = resolve;
    });
    if (resolveActiveOperation === undefined) invalidProgram();
    const settleActiveOperation = resolveActiveOperation;
    const clearActiveOperation = (): void => {
      settleActiveOperation();
      if (state.activeOperation === activeOperation) state.activeOperation = undefined;
    };
    state.activeOperation = activeOperation;

    try {
      providerOperation = Promise.resolve(
        state.connection.execute<unknown>(registration.text, parametersOwner.values),
      );
    } catch (error: unknown) {
      parametersOwner.erase();
      this.#poison(state, this.#statementFailure(registration, error));
      clearActiveOperation();
      throw new MySqlTransactionStatementExecutionError();
    }

    const operation = providerOperation.then(
      (value) => {
        parametersOwner.erase();

        let decoded: MySqlTransactionStatementResult<Statement>;

        try {
          decoded = capturedReflectApply(registration.decode, undefined, [
            value,
          ]) as MySqlTransactionStatementResult<Statement>;
        } catch {
          this.#poison(state, this.#program.unavailableFailure);
          throw new MySqlTransactionStatementExecutionError();
        }

        return Promise.resolve(decoded).then(
          (result): MySqlTransactionStatementResult<Statement> => result,
          (): never => {
            this.#poison(state, this.#program.unavailableFailure);
            throw new MySqlTransactionStatementExecutionError();
          },
        );
      },
      (error: unknown): never => {
        parametersOwner.erase();
        this.#poison(state, this.#statementFailure(registration, error));
        throw new MySqlTransactionStatementExecutionError();
      },
    );
    const exposedOperation = operation.then(
      (result): MySqlTransactionStatementResult<Statement> => {
        clearActiveOperation();
        return result;
      },
      (): never => {
        this.#poison(state, this.#program.unavailableFailure);
        clearActiveOperation();
        throw new MySqlTransactionStatementExecutionError();
      },
    );
    return exposedOperation;
  }

  #statementFailure(
    registration: ReturnType<typeof getMySqlTransactionStatementRegistration>,
    providerError: unknown,
  ): Failure {
    const constraintName = duplicateConstraintName(providerError);
    const mappedFailure =
      constraintName === undefined
        ? undefined
        : mapGet(registration.duplicateKeyFailures, constraintName);

    return mappedFailure !== undefined && setHas(this.#program.failures, mappedFailure as Failure)
      ? (mappedFailure as Failure)
      : this.#program.unavailableFailure;
  }

  #requestDirective(
    state: ExecutionState<CommitResult, Failure>,
    disposition: 'commit' | 'rollback',
    result: CommitResult | Failure,
  ): MySqlTransactionDirective<CommitResult, Failure> {
    if (
      state.sessionStatus !== 'active' ||
      state.phase !== 'active' ||
      state.directive !== undefined ||
      state.activeOperation !== undefined ||
      state.failure !== undefined ||
      (disposition === 'rollback' && !setHas(this.#program.failures, result as Failure))
    ) {
      this.#poison(state, this.#program.defectFailure);
      invalidProgram();
    }

    const directive = capturedFreeze({}) as MySqlTransactionDirective<CommitResult, Failure>;
    const outcome: MySqlTransactionOutcome<CommitResult, Failure> =
      disposition === 'commit'
        ? capturedFreeze({ kind: 'committed', result: result as CommitResult })
        : capturedFreeze({ kind: 'not-committed', failure: result as Failure });
    const registration: DirectiveRegistration<CommitResult, Failure> = {
      authority: state.authority,
      directive,
      disposition,
      outcome,
    };

    weakMapSet(directiveRegistrations, directive, registration);
    state.directive = directive;
    return directive;
  }

  #poison(state: ExecutionState<CommitResult, Failure>, failure: Failure): void {
    state.failure ??= failure;
  }

  #clearDirective(state: ExecutionState<CommitResult, Failure>): void {
    if (state.directive === undefined) return;

    const registration = directiveRegistrationFor<CommitResult, Failure>(state.directive);

    if (registration !== undefined) registration.outcome = undefined;
    deleteDirective(state.directive);
    state.directive = undefined;
  }

  async #commit(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
    outcome: MySqlTransactionOutcome<CommitResult, Failure>,
  ): Promise<MySqlTransactionOutcome<CommitResult, Failure>> {
    state.phase = 'commit-requested';
    const commit = await this.#control(state, deadline, COMMIT_TRANSACTION);

    if (commit.kind !== 'fulfilled') {
      state.phase = 'indeterminate';
      await this.#retire(state, deadline);
      return INDETERMINATE_OUTCOME;
    }

    state.phase = 'committed';
    await this.#retire(state, deadline);
    return outcome;
  }

  async #rollback(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
    outcome: MySqlTransactionOutcome<CommitResult, Failure>,
  ): Promise<MySqlTransactionOutcome<CommitResult, Failure>> {
    state.phase = 'rollback-requested';
    const rollback = await this.#control(state, deadline, ROLLBACK_TRANSACTION);

    if (rollback.kind === 'fulfilled') {
      state.phase = 'rolled-back';
      await this.#retire(state, deadline);
      return outcome;
    }

    const retired = await this.#retire(state, deadline);

    if (retired) {
      state.phase = 'rolled-back';
      return outcome;
    }

    state.phase = 'indeterminate';
    return INDETERMINATE_OUTCOME;
  }

  async #retire(
    state: ExecutionState<CommitResult, Failure>,
    deadline: TransactionDeadline,
  ): Promise<boolean> {
    if (state.leaseSettled || deadline.hasExpired()) return false;

    let release: Promise<void>;

    try {
      release = state.owner.release(state.lease);
    } catch {
      try {
        state.owner.destroy(state.lease);
      } catch {
        // A fixed outcome never carries retirement internals.
      } finally {
        state.leaseSettled = true;
      }

      return false;
    }

    const retirement = await deadline.observe(release);
    state.leaseSettled = true;
    return retirement.kind === 'fulfilled';
  }
}

// These are sealed during module evaluation, before the exported factory can
// release an instance. A recovered constructor therefore cannot be altered or
// used without the module-private construction authority.
capturedFreeze(ManagedMySqlTransactionExecutor.prototype);
capturedFreeze(ManagedMySqlTransactionExecutor);

export function createMySqlTransactionExecutor<
  Input,
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
>(
  runtime: DatabaseRuntime,
  program: MySqlTransactionProgram<Input, CommitResult, Failure, Statements>,
  options: MySqlTransactionExecutorOptions,
): MySqlTransactionExecutor<Input, CommitResult, Failure> {
  let owner: ManagedMariaDbConnectionLeaseOwner<unknown>;

  try {
    owner = getRuntimeMariaDbConnectionLeaseOwner(runtime);
  } catch {
    invalidExecutor();
  }

  const construct = constructManagedMySqlTransactionExecutor;

  if (construct === undefined) invalidExecutor();

  return capturedFreeze(construct(EXECUTOR_CONSTRUCTION_AUTHORITY, owner, program, options));
}
