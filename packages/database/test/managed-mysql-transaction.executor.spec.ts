import type {
  ManagedMariaDbAllocatedConnection,
  ManagedMariaDbConnectionAllocator,
} from '../src/client/managed-mariadb-connection-lease.owner';
import { ManagedMariaDbConnectionLeaseOwner } from '../src/client/managed-mariadb-connection-lease.owner';
import * as managedExecutorModule from '../src/client/managed-mysql-transaction.executor';
import type { DatabaseRuntime } from '../src/database.contract';
import type {
  MySqlTransactionDirective,
  MySqlTransactionExecutor,
  MySqlTransactionProgram,
  MySqlTransactionProgramContext,
} from '../src/mysql-transaction.contract';
import { defineMySqlTransactionStatement } from '../src/mysql-transaction.statement';
import { createMySqlTransactionExecutor } from '../src/mysql-transaction';
import { createDatabaseResourcesRuntime } from '../src/prisma-database.runtime';

const SET_UTC = "SET SESSION time_zone = '+00:00'";
const SET_READ_COMMITTED = 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED';
const START_TRANSACTION = 'START TRANSACTION READ WRITE';
const COMMIT = 'COMMIT';
const ROLLBACK = 'ROLLBACK';
const VALUE_SQL = 'SELECT ? AS value';
const DUPLICATE_SQL = 'INSERT INTO executor_probe (probe_value) VALUES (?)';
const BINARY_SQL = 'UPDATE executor_probe SET probe_payload = ? WHERE probe_id = 1';
const DECODER_REJECTION_SQL = 'SELECT 1 AS decoder_rejection';

type Failure = 'unavailable' | 'defect' | 'requested' | 'collision';
type CommitResult = Readonly<{ value: string }>;
type ProgramInput = Readonly<{ mode?: string; value: string }>;

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: Value) => void;
}

interface QueryCall {
  readonly method: 'execute' | 'query';
  readonly sql: string;
  readonly values: readonly unknown[] | undefined;
}

interface ConnectionHarness {
  readonly calls: QueryCall[];
  readonly connection: ManagedMariaDbAllocatedConnection;
  readonly destroy: jest.MockedFunction<() => void>;
  readonly release: jest.MockedFunction<() => Promise<void>>;
}

interface ExecutorHarness {
  readonly allocator: ManagedMariaDbConnectionAllocator;
  readonly end: jest.MockedFunction<() => Promise<void>>;
  readonly executor: MySqlTransactionExecutor<ProgramInput, CommitResult, Failure>;
  readonly getConnection: jest.MockedFunction<() => Promise<ManagedMariaDbAllocatedConnection>>;
  readonly owner: ManagedMariaDbConnectionLeaseOwner<unknown>;
}

type QueryImplementation = (
  sql: string,
  values: readonly unknown[] | undefined,
) => Promise<unknown>;

const valueStatement = defineMySqlTransactionStatement<readonly [string], string, Failure>({
  decode(value: unknown): string {
    const rows = value as readonly Readonly<{ value: string }>[];
    const row = rows[0];

    if (row === undefined || typeof row.value !== 'string') {
      throw new TypeError('Invalid value row');
    }

    return row.value;
  },
  parameterCount: 1,
  text: VALUE_SQL,
});

const duplicateStatement = defineMySqlTransactionStatement<readonly [string], undefined, Failure>({
  decode(): undefined {
    return undefined;
  },
  duplicateKeyFailures: {
    uq_executor_probe_value: 'collision',
  },
  parameterCount: 1,
  text: DUPLICATE_SQL,
});

const binaryStatement = defineMySqlTransactionStatement<readonly [Uint8Array], undefined, Failure>({
  decode(): undefined {
    return undefined;
  },
  parameterCount: 1,
  text: BINARY_SQL,
});

const rejectingDecoderStatement = defineMySqlTransactionStatement<readonly [], string, Failure>({
  decode(): string {
    return Promise.reject(new Error('asynchronous decoder secret')) as unknown as string;
  },
  parameterCount: 0,
  text: DECODER_REJECTION_SQL,
});

type ProgramStatement =
  | typeof valueStatement
  | typeof duplicateStatement
  | typeof binaryStatement
  | typeof rejectingDecoderStatement;
type ProgramContext = MySqlTransactionProgramContext<CommitResult, Failure, ProgramStatement>;
type TransactionProgram = MySqlTransactionProgram<
  ProgramInput,
  CommitResult,
  Failure,
  ProgramStatement
>;
type ProgramRun = TransactionProgram['run'];
type ProgramSettlementObserver = NonNullable<TransactionProgram['observeProgramSettlement']>;

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<Value>((resolve, reject): void => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: (error): void => rejectPromise?.(error),
    resolve: (value): void => resolvePromise?.(value),
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function isSessionCharacteristicsRead(sql: string): boolean {
  return sql.includes('@@SESSION.time_zone') && sql.includes('@@SESSION.transaction_isolation');
}

function defaultQueryResult(sql: string, values: readonly unknown[] | undefined): Promise<unknown> {
  if (isSessionCharacteristicsRead(sql)) {
    return Promise.resolve([
      {
        transaction_isolation: 'READ-COMMITTED',
        time_zone: '+00:00',
      },
    ]);
  }

  if (normalizeSql(sql) === VALUE_SQL) {
    return Promise.resolve([{ value: values?.[0] }]);
  }

  return Promise.resolve({});
}

function connectionHarness(
  implementation: QueryImplementation = defaultQueryResult,
  releaseImplementation: () => Promise<void> = (): Promise<void> => Promise.resolve(),
): ConnectionHarness {
  const calls: QueryCall[] = [];
  const destroy = jest.fn((): void => undefined);
  const release = jest.fn(releaseImplementation);
  const invoke = (
    method: QueryCall['method'],
    sql: string,
    values?: readonly unknown[],
  ): Promise<unknown> => {
    calls.push({ method, sql, values });
    return implementation(sql, values);
  };
  const connection: ManagedMariaDbAllocatedConnection = {
    destroy,
    execute: <Result>(sql: string, values: readonly unknown[]): Promise<Result> =>
      invoke('execute', sql, values) as Promise<Result>,
    query: <Result>(sql: string, values?: readonly unknown[]): Promise<Result> =>
      invoke('query', sql, values) as Promise<Result>,
    release,
  };

  return { calls, connection, destroy, release };
}

function transactionProgram(
  run: ProgramRun,
  observeProgramSettlement?: ProgramSettlementObserver,
): TransactionProgram {
  const program = {
    defectFailure: 'defect' as const,
    failures: Object.freeze(['unavailable', 'defect', 'requested', 'collision'] as const),
    run,
    statements: Object.freeze([
      valueStatement,
      duplicateStatement,
      binaryStatement,
      rejectingDecoderStatement,
    ] as const),
    unavailableFailure: 'unavailable' as const,
  };

  return observeProgramSettlement === undefined
    ? Object.freeze(program)
    : Object.freeze({ ...program, observeProgramSettlement });
}

function executorHarness(
  program: MySqlTransactionProgram<ProgramInput, CommitResult, Failure, ProgramStatement>,
  connections: readonly ConnectionHarness[],
  timeoutMilliseconds = 1_000,
): ExecutorHarness {
  let connectionIndex = 0;
  const getConnection = jest.fn((): Promise<ManagedMariaDbAllocatedConnection> => {
    const harness = connections[connectionIndex];
    connectionIndex += 1;

    return harness === undefined
      ? Promise.reject(new Error('No test connection available'))
      : Promise.resolve(harness.connection);
  });
  const end = jest.fn((): Promise<void> => Promise.resolve());
  const allocator: ManagedMariaDbConnectionAllocator = { end, getConnection };
  const owner = new ManagedMariaDbConnectionLeaseOwner<unknown>(
    (): ManagedMariaDbConnectionAllocator => allocator,
    {},
  );
  const runtime = createDatabaseResourcesRuntime(
    { $disconnect: (): Promise<void> => Promise.resolve() } as never,
    owner,
  );
  const executor = createMySqlTransactionExecutor(runtime, program, {
    timeoutMilliseconds,
  });

  return { allocator, end, executor, getConnection, owner };
}

async function flushUntil(predicate: () => boolean, message: string): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }

  throw new Error(message);
}

function sqlTrace(harness: ConnectionHarness): string[] {
  return harness.calls.map((call) => normalizeSql(call.sql));
}

function duplicateError(
  overrides: Partial<
    Readonly<{ code: unknown; errno: unknown; sqlMessage: string; sqlState: unknown }>
  > = {},
): Error {
  return Object.assign(new Error('provider wrapper\nsql: INSERT INTO secret (?)'), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: "Duplicate entry 'secret-value' for key 'uq_executor_probe_value'",
    sqlState: '23000',
    ...overrides,
  });
}

describe('ManagedMySqlTransactionExecutor', (): void => {
  it('keeps the implementation class private and seals its prototype before escape', (): void => {
    const connection = connectionHarness();
    const program = transactionProgram((context) =>
      Promise.resolve(context.requestRollback('requested')),
    );
    const { executor } = executorHarness(program, [connection]);
    const prototype: unknown = Object.getPrototypeOf(executor);

    expect(managedExecutorModule).not.toHaveProperty('ManagedMySqlTransactionExecutor');
    expect(prototype).not.toBeNull();
    expect(typeof prototype).toBe('object');

    if (prototype === null || typeof prototype !== 'object') {
      throw new Error('The executor prototype was not available');
    }

    const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    const recoveredConstructor: unknown = (
      constructorDescriptor as Readonly<{ value?: unknown }> | undefined
    )?.value;

    expect(Object.isFrozen(prototype)).toBe(true);
    expect(typeof recoveredConstructor).toBe('function');
    expect(Object.isFrozen(recoveredConstructor)).toBe(true);
    expect(() =>
      Object.defineProperty(prototype, 'execute', {
        configurable: true,
        value: (): Promise<never> => Promise.reject(new Error('prototype replacement')),
      }),
    ).toThrow(TypeError);
  });

  it('rejects recovered-constructor and foreign-new-target construction attempts', (): void => {
    const connection = connectionHarness();
    const program = transactionProgram((context) =>
      Promise.resolve(context.requestRollback('requested')),
    );
    const { executor, owner } = executorHarness(program, [connection]);
    const prototype: unknown = Object.getPrototypeOf(executor);

    if (prototype === null || typeof prototype !== 'object') {
      throw new Error('The executor prototype was not available');
    }

    const recoveredConstructor: unknown = Object.getOwnPropertyDescriptor(
      prototype,
      'constructor',
    )?.value;

    if (typeof recoveredConstructor !== 'function') {
      throw new Error('The executor constructor was not recoverable for the adversarial test');
    }

    const options = Object.freeze({ timeoutMilliseconds: 1_000 });
    const guessedAuthority = Object.freeze({});
    const foreignNewTarget = function ForeignMySqlTransactionExecutor(): void {
      // Reflect.construct only uses this function as the forged new.target.
    };

    expect((): void => {
      Reflect.construct(recoveredConstructor, [owner, program, options]);
    }).toThrow('Invalid MySQL transaction executor configuration');
    expect((): void => {
      Reflect.construct(
        recoveredConstructor,
        [guessedAuthority, owner, program, options],
        foreignNewTarget,
      );
    }).toThrow('Invalid MySQL transaction executor configuration');
  });

  it('derives a frozen capability only from an authentic database runtime', async (): Promise<void> => {
    const end = jest.fn((): Promise<void> => Promise.resolve());
    const owner = new ManagedMariaDbConnectionLeaseOwner<unknown>(
      (): ManagedMariaDbConnectionAllocator => ({
        end,
        getConnection: (): Promise<ManagedMariaDbAllocatedConnection> =>
          Promise.reject(new Error('not used')),
      }),
      {},
    );
    const disconnect = jest.fn((): Promise<void> => Promise.resolve());
    const runtime = createDatabaseResourcesRuntime({ $disconnect: disconnect } as never, owner);
    const program = transactionProgram((context) =>
      Promise.resolve(context.requestRollback('requested')),
    );

    try {
      const executor = createMySqlTransactionExecutor(runtime, program, {
        timeoutMilliseconds: 1_000,
      });

      expect(Object.isFrozen(executor)).toBe(true);
      expect(Reflect.ownKeys(executor)).toEqual([]);
      expect(executor).not.toHaveProperty('owner');

      const forgedRuntime: DatabaseRuntime = {
        close: (): Promise<void> => Promise.resolve(),
        connection: {
          close: (): Promise<void> => Promise.resolve(),
          probe: (): Promise<void> => Promise.resolve(),
        },
      };
      expect(() =>
        createMySqlTransactionExecutor(forgedRuntime, program, {
          timeoutMilliseconds: 1_000,
        }),
      ).toThrow('Invalid MySQL transaction executor configuration');
    } finally {
      await runtime.close();
    }

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  it('rejects a forged runtime when WeakMap prototype dispatch is sabotaged', (): void => {
    const owner = new ManagedMariaDbConnectionLeaseOwner<unknown>(
      (): ManagedMariaDbConnectionAllocator => ({
        end: (): Promise<void> => Promise.resolve(),
        getConnection: (): Promise<ManagedMariaDbAllocatedConnection> =>
          Promise.reject(new Error('not used')),
      }),
      {},
    );
    const forgedRuntime: DatabaseRuntime = {
      close: (): Promise<void> => Promise.resolve(),
      connection: {
        close: (): Promise<void> => Promise.resolve(),
        probe: (): Promise<void> => Promise.resolve(),
      },
    };
    const program = transactionProgram((context) =>
      Promise.resolve(context.requestRollback('requested')),
    );
    const weakMapGetDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, 'get');
    let executor: unknown;
    let failure: unknown;

    if (weakMapGetDescriptor === undefined) {
      throw new Error('Expected WeakMap.prototype.get');
    }

    try {
      Object.defineProperty(WeakMap.prototype, 'get', {
        ...weakMapGetDescriptor,
        value: (): ManagedMariaDbConnectionLeaseOwner<unknown> => owner,
      });

      try {
        executor = createMySqlTransactionExecutor(forgedRuntime, program, {
          timeoutMilliseconds: 1_000,
        });
      } catch (error: unknown) {
        failure = error;
      }
    } finally {
      Object.defineProperty(WeakMap.prototype, 'get', weakMapGetDescriptor);
    }

    expect(executor).toBeUndefined();
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty('name', 'InvalidMySqlTransactionExecutorError');
    expect(failure).toHaveProperty('message', 'Invalid MySQL transaction executor configuration');
  });

  it('commits one fixed program in the exact same-connection control order', async (): Promise<void> => {
    const connection = connectionHarness();
    let observedContext: ProgramContext | undefined;
    const program = transactionProgram(async (context, input) => {
      observedContext = context;
      const value = await context.executeStatement(valueStatement, [input.value]);
      return context.requestCommit(Object.freeze({ value }));
    });
    const { executor, getConnection } = executorHarness(program, [connection]);

    const outcome = await executor.execute({ value: 'committed-value' });

    expect(outcome).toEqual({ kind: 'committed', result: { value: 'committed-value' } });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(sqlTrace(connection)).toEqual([
      SET_UTC,
      SET_READ_COMMITTED,
      START_TRANSACTION,
      'SELECT @@SESSION.time_zone AS time_zone, @@SESSION.transaction_isolation AS transaction_isolation',
      VALUE_SQL,
      COMMIT,
    ]);
    expect(connection.calls[4]?.values).toEqual(['committed-value']);
    expect(connection.calls.map((call) => call.method)).toEqual([
      'query',
      'query',
      'query',
      'query',
      'execute',
      'query',
    ]);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(observedContext).toBeDefined();
    expect(Object.isFrozen(observedContext)).toBe(true);
    expect(Reflect.ownKeys(observedContext ?? {})).toEqual([
      'executeStatement',
      'requestCommit',
      'requestRollback',
    ]);
    expect(observedContext).not.toHaveProperty('query');
    expect(observedContext).not.toHaveProperty('commit');
    expect(observedContext).not.toHaveProperty('rollback');
    expect(executor).not.toHaveProperty('owner');
  });

  it('allows sequential awaited statements while retaining exact single-operation ownership', async (): Promise<void> => {
    const connection = connectionHarness();
    const program = transactionProgram(async (context) => {
      const first = await context.executeStatement(valueStatement, ['first']);
      const second = await context.executeStatement(valueStatement, ['second']);
      return context.requestCommit(Object.freeze({ value: `${first}:${second}` }));
    });
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
      kind: 'committed',
      result: { value: 'first:second' },
    });
    expect(sqlTrace(connection).filter((sql) => sql === VALUE_SQL)).toHaveLength(2);
    expect(connection.calls.filter((call) => normalizeSql(call.sql) === VALUE_SQL)).toEqual([
      { method: 'execute', sql: VALUE_SQL, values: ['first'] },
      { method: 'execute', sql: VALUE_SQL, values: ['second'] },
    ]);
    expect(sqlTrace(connection).at(-1)).toBe(COMMIT);
  });

  it('copies binary parameters before the driver call and erases only its copy after settlement', async (): Promise<void> => {
    const statementResult = deferred<unknown>();
    let boundCopy: Uint8Array | undefined;
    const connection = connectionHarness((sql, values) => {
      if (normalizeSql(sql) === BINARY_SQL) {
        const candidate = values?.[0];

        if (!(candidate instanceof Uint8Array)) {
          return Promise.reject(new Error('Expected copied binary parameter'));
        }

        boundCopy = candidate;
        return statementResult.promise;
      }

      return defaultQueryResult(sql, values);
    });
    const callerBytes = new Uint8Array([1, 2, 3, 4]);
    const program = transactionProgram(async (context) => {
      await context.executeStatement(binaryStatement, [callerBytes]);
      return context.requestRollback('requested');
    });
    const { executor } = executorHarness(program, [connection]);
    const execution = executor.execute({ value: 'unused' });

    await flushUntil(() => boundCopy !== undefined, 'The binary statement did not start');
    expect(boundCopy).not.toBe(callerBytes);
    expect(Array.from(boundCopy ?? [])).toEqual([1, 2, 3, 4]);

    callerBytes.fill(9);
    expect(Array.from(boundCopy ?? [])).toEqual([1, 2, 3, 4]);
    statementResult.resolve({});

    await expect(execution).resolves.toEqual({
      kind: 'not-committed',
      failure: 'requested',
    });
    expect(Array.from(boundCopy ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(callerBytes)).toEqual([9, 9, 9, 9]);
  });

  it('honors an authentic requested rollback without issuing a statement or commit', async (): Promise<void> => {
    const connection = connectionHarness();
    const program = transactionProgram((context) =>
      Promise.resolve(context.requestRollback('requested')),
    );
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'requested',
    });
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
    expect(sqlTrace(connection)).not.toContain(VALUE_SQL);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('returns unavailable before BEGIN when session establishment fails', async (): Promise<void> => {
    const connection = connectionHarness((sql, values) =>
      normalizeSql(sql) === SET_UTC
        ? Promise.reject(new Error('provider setup secret'))
        : defaultQueryResult(sql, values),
    );
    const run = jest.fn((context: ProgramContext) =>
      Promise.resolve(context.requestRollback('requested')),
    );
    const { executor } = executorHarness(transactionProgram(run), [connection]);

    await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'unavailable',
    });
    expect(run).not.toHaveBeenCalled();
    expect(sqlTrace(connection)).toEqual([SET_UTC]);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back unavailable when the same-connection UTC or isolation assertion fails', async (): Promise<void> => {
    const connection = connectionHarness((sql, values) =>
      isSessionCharacteristicsRead(sql)
        ? Promise.resolve([
            {
              transaction_isolation: 'REPEATABLE-READ',
              time_zone: '+00:00',
            },
          ])
        : defaultQueryResult(sql, values),
    );
    const run = jest.fn((context: ProgramContext) =>
      Promise.resolve(context.requestRollback('requested')),
    );
    const { executor } = executorHarness(transactionProgram(run), [connection]);

    await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'unavailable',
    });
    expect(run).not.toHaveBeenCalled();
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('collapses a hostile program rejection into a proven defect rollback', async (): Promise<void> => {
    let trapCalls = 0;
    const hostile = new Proxy(new Error('hostile program secret'), {
      get(): never {
        trapCalls += 1;
        throw new Error('hostile program secret');
      },
    });
    const connection = connectionHarness();
    const program = transactionProgram((): Promise<never> => Promise.reject(hostile));
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(trapCalls).toBe(0);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('observes a fulfilled program exactly once, receiver-free, before commit', async (): Promise<void> => {
    const programGate = deferred<undefined>();
    const connection = connectionHarness();
    const input = Object.freeze({ value: 'observed-fulfillment' });
    let runStarted = false;
    let observerCalls = 0;
    let observedInput: ProgramInput | undefined;
    let receiverWasUndefined = false;
    let traceAtObservation: readonly string[] | undefined;
    const program = transactionProgram(
      async (context, programInput) => {
        runStarted = true;
        await programGate.promise;
        return context.requestCommit(Object.freeze({ value: programInput.value }));
      },
      function observeProgramSettlement(this: undefined, programInput): undefined {
        observerCalls += 1;
        observedInput = programInput;
        receiverWasUndefined = (this as unknown) === undefined;
        traceAtObservation = sqlTrace(connection);
        return undefined;
      },
    );
    const { executor } = executorHarness(program, [connection]);
    const execution = executor.execute(input);

    await flushUntil(() => runStarted, 'The fulfilled program did not start');
    expect(observerCalls).toBe(0);

    programGate.resolve(undefined);

    await expect(execution).resolves.toEqual({
      kind: 'committed',
      result: { value: 'observed-fulfillment' },
    });
    expect(observerCalls).toBe(1);
    expect(observedInput).toBe(input);
    expect(receiverWasUndefined).toBe(true);
    expect(traceAtObservation).not.toContain(COMMIT);
    expect(traceAtObservation).not.toContain(ROLLBACK);
    expect(sqlTrace(connection).at(-1)).toBe(COMMIT);
  });

  it('captures the optional settlement observer once during construction', async (): Promise<void> => {
    const connection = connectionHarness();
    const originalObserver = jest.fn((): undefined => undefined);
    const replacementObserver = jest.fn((): undefined => undefined);
    const mutableProgram = {
      defectFailure: 'defect' as const,
      failures: Object.freeze(['unavailable', 'defect', 'requested', 'collision'] as const),
      observeProgramSettlement: originalObserver,
      run: ((context, input) =>
        Promise.resolve(
          context.requestCommit(Object.freeze({ value: input.value })),
        )) satisfies ProgramRun,
      statements: Object.freeze([
        valueStatement,
        duplicateStatement,
        binaryStatement,
        rejectingDecoderStatement,
      ] as const),
      unavailableFailure: 'unavailable' as const,
    };
    const { executor } = executorHarness(mutableProgram, [connection]);

    mutableProgram.observeProgramSettlement = replacementObserver;

    await expect(executor.execute({ value: 'captured-observer' })).resolves.toEqual({
      kind: 'committed',
      result: { value: 'captured-observer' },
    });
    expect(originalObserver).toHaveBeenCalledTimes(1);
    expect(replacementObserver).not.toHaveBeenCalled();
  });

  it('rejects a present non-function or accessor settlement observer without invocation', (): void => {
    const run: ProgramRun = (context) => Promise.resolve(context.requestRollback('requested'));
    const base = transactionProgram(run);
    const explicitUndefined = {
      ...base,
      observeProgramSettlement: undefined,
    } as unknown as TransactionProgram;
    let getterCalls = 0;
    const accessor = { ...base } as unknown as Record<PropertyKey, unknown>;

    Object.defineProperty(accessor, 'observeProgramSettlement', {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error('observer getter secret');
      },
    });

    for (const invalidProgram of [explicitUndefined, accessor as TransactionProgram]) {
      expect(() => executorHarness(invalidProgram, [connectionHarness()])).toThrow(
        'Invalid MySQL transaction executor configuration',
      );
    }
    expect(getterCalls).toBe(0);
  });

  it('observes a rejected program exactly once, receiver-free, before rollback', async (): Promise<void> => {
    const programGate = deferred<MySqlTransactionDirective<CommitResult, Failure>>();
    let trapCalls = 0;
    const hostile = new Proxy(new Error('late rejected program secret'), {
      get(): never {
        trapCalls += 1;
        throw new Error('late rejected program secret');
      },
    });
    const connection = connectionHarness();
    const input = Object.freeze({ value: 'observed-rejection' });
    let runStarted = false;
    let observerCalls = 0;
    let observedInput: ProgramInput | undefined;
    let receiverWasUndefined = false;
    let traceAtObservation: readonly string[] | undefined;
    const program = transactionProgram(
      () => {
        runStarted = true;
        return programGate.promise;
      },
      function observeProgramSettlement(this: undefined, programInput): undefined {
        observerCalls += 1;
        observedInput = programInput;
        receiverWasUndefined = (this as unknown) === undefined;
        traceAtObservation = sqlTrace(connection);
        return undefined;
      },
    );
    const { executor } = executorHarness(program, [connection]);
    const execution = executor.execute(input);

    await flushUntil(() => runStarted, 'The rejected program did not start');
    expect(observerCalls).toBe(0);

    programGate.reject(hostile);

    await expect(execution).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(observerCalls).toBe(1);
    expect(observedInput).toBe(input);
    expect(receiverWasUndefined).toBe(true);
    expect(traceAtObservation).not.toContain(COMMIT);
    expect(traceAtObservation).not.toContain(ROLLBACK);
    expect(trapCalls).toBe(0);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
  });

  it('seals statement and directive authority before invoking the settlement observer', async (): Promise<void> => {
    const connection = connectionHarness();
    let context: ProgramContext | undefined;
    let observerCalls = 0;
    let statementReentryRejected = false;
    let directiveReentryRejected = false;
    const program = transactionProgram(
      (programContext) => {
        context = programContext;
        return Promise.resolve(
          Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>,
        );
      },
      (): undefined => {
        observerCalls += 1;

        if (context === undefined) throw new Error('The program context was not captured');

        try {
          void context.executeStatement(valueStatement, ['observer-reentry']);
        } catch {
          statementReentryRejected = true;
        }

        try {
          context.requestCommit(Object.freeze({ value: 'observer-forgery' }));
        } catch {
          directiveReentryRejected = true;
        }

        return undefined;
      },
    );
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'must-not-commit' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(observerCalls).toBe(1);
    expect(statementReentryRejected).toBe(true);
    expect(directiveReentryRejected).toBe(true);
    expect(sqlTrace(connection)).not.toContain(VALUE_SQL);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
  });

  it('contains a thrown settlement observer and denies the program commit', async (): Promise<void> => {
    let trapCalls = 0;
    const hostile = new Proxy(new Error('settlement observer secret'), {
      get(): never {
        trapCalls += 1;
        throw new Error('settlement observer secret');
      },
    });
    const connection = connectionHarness();
    let observerCalls = 0;
    const program = transactionProgram(
      (context, input) =>
        Promise.resolve(context.requestCommit(Object.freeze({ value: input.value }))),
      (): never => {
        observerCalls += 1;
        throw hostile;
      },
    );
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'must-not-commit' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(observerCalls).toBe(1);
    expect(trapCalls).toBe(0);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
  });

  it('does not let a failing observer overwrite an earlier mapped statement failure', async (): Promise<void> => {
    const connection = connectionHarness((sql, values) =>
      normalizeSql(sql) === DUPLICATE_SQL
        ? Promise.reject(duplicateError())
        : defaultQueryResult(sql, values),
    );
    const program = transactionProgram(
      async (context) => {
        try {
          await context.executeStatement(duplicateStatement, ['sticky-collision']);
        } catch {
          // The program cannot select settlement after the statement failure is sticky.
        }

        return Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>;
      },
      (): never => {
        throw new Error('observer defect must not overwrite collision');
      },
    );
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'sticky-collision' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'collision',
    });
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
  });

  it('does not assimilate a non-undefined async-like observer result or allow commit', async (): Promise<void> => {
    let thenTrapCalls = 0;
    const asyncLike = Object.defineProperty(Object.create(null) as object, 'then', {
      get(): never {
        thenTrapCalls += 1;
        throw new Error('settlement observer thenable secret');
      },
    });
    const connection = connectionHarness();
    let observerCalls = 0;
    const nonContractObserver = ((): object => {
      observerCalls += 1;
      return asyncLike;
    }) as unknown as ProgramSettlementObserver;
    const program = transactionProgram(
      (context, input) =>
        Promise.resolve(context.requestCommit(Object.freeze({ value: input.value }))),
      nonContractObserver,
    );
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'must-not-commit' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(observerCalls).toBe(1);
    expect(thenTrapCalls).toBe(0);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
  });

  it.each(['returns', 'throws'] as const)(
    'contains a native rejected Promise that the settlement observer %s',
    async (mode): Promise<void> => {
      const connection = connectionHarness();
      const unhandledReasons: unknown[] = [];
      const onUnhandledRejection = (reason: unknown): void => {
        unhandledReasons.push(reason);
      };
      let observerCalls = 0;
      const nonContractObserver = ((): Promise<never> => {
        observerCalls += 1;
        const rejection = Promise.reject(new Error('async settlement observer secret'));

        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Adversarial runtime input may throw any value.
        if (mode === 'throws') throw rejection;
        return rejection;
      }) as unknown as ProgramSettlementObserver;
      const program = transactionProgram(
        (context, input) =>
          Promise.resolve(context.requestCommit(Object.freeze({ value: input.value }))),
        nonContractObserver,
      );
      const { executor } = executorHarness(program, [connection]);

      process.on('unhandledRejection', onUnhandledRejection);
      try {
        await expect(executor.execute({ value: 'must-not-commit' })).resolves.toEqual({
          kind: 'not-committed',
          failure: 'defect',
        });
        await new Promise<void>((resolve): void => {
          setImmediate(resolve);
        });
      } finally {
        process.off('unhandledRejection', onUnhandledRejection);
      }

      expect(observerCalls).toBe(1);
      expect(unhandledReasons).toEqual([]);
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    },
  );

  it('does not inspect a modified native Promise while denying observer commit', async (): Promise<void> => {
    let constructorReads = 0;
    const modifiedPromise = Promise.resolve(undefined);

    void Object.defineProperty(modifiedPromise, 'constructor', {
      get(): never {
        constructorReads += 1;
        throw new Error('modified Promise constructor secret');
      },
    });

    const connection = connectionHarness();
    const nonContractObserver = (() => modifiedPromise) as unknown as ProgramSettlementObserver;
    const program = transactionProgram(
      (context, input) =>
        Promise.resolve(context.requestCommit(Object.freeze({ value: input.value }))),
      nonContractObserver,
    );
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'must-not-commit' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(constructorReads).toBe(0);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
  });

  it('publishes program settlement only after a tracked floated statement drains', async (): Promise<void> => {
    const pendingStatement = deferred<unknown>();
    const connection = connectionHarness((sql, values) =>
      normalizeSql(sql) === VALUE_SQL ? pendingStatement.promise : defaultQueryResult(sql, values),
    );
    let observerCalls = 0;
    const program = transactionProgram(
      (context) => {
        void context.executeStatement(valueStatement, ['floated-observer']).catch(() => undefined);
        return Promise.resolve(
          Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>,
        );
      },
      (): undefined => {
        observerCalls += 1;
        return undefined;
      },
    );
    const { executor } = executorHarness(program, [connection]);
    const execution = executor.execute({ value: 'must-not-commit' });

    await flushUntil(
      () => sqlTrace(connection).includes(VALUE_SQL),
      'The floated observer statement did not start',
    );
    await Promise.resolve();
    expect(observerCalls).toBe(0);
    expect(sqlTrace(connection)).not.toContain(ROLLBACK);

    pendingStatement.resolve([{ value: 'floated-observer' }]);

    await expect(execution).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(observerCalls).toBe(1);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
  });

  it('makes an asynchronous decoder rejection sticky even when the program catches it', async (): Promise<void> => {
    const connection = connectionHarness();
    const program = transactionProgram(async (context, input) => {
      try {
        await context.executeStatement(rejectingDecoderStatement, []);
      } catch {
        // Decoder thenables are outside the contract and cannot be recovered by the program.
      }

      return context.requestCommit(Object.freeze({ value: input.value }));
    });
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'must-not-commit' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'unavailable',
    });
    expect(sqlTrace(connection)).toContain(DECODER_REJECTION_SQL);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
  });

  it.each([
    ['exact identity', duplicateError(), 'collision'],
    ['wrong errno', duplicateError({ errno: 1061 }), 'unavailable'],
    ['wrong code', duplicateError({ code: 'ER_DUP_KEY' }), 'unavailable'],
    ['wrong SQL state', duplicateError({ sqlState: '40001' }), 'unavailable'],
    [
      'unknown constraint',
      duplicateError({
        sqlMessage: "Duplicate entry 'secret-value' for key 'uq_foreign_constraint'",
      }),
      'unavailable',
    ],
    [
      'non-terminal constraint text',
      duplicateError({
        sqlMessage:
          "Duplicate entry 'secret-value' for key 'uq_executor_probe_value' trailing-detail",
      }),
      'unavailable',
    ],
  ] as const)(
    'maps duplicate-key failure only for the %s',
    async (_scenario, providerError, expectedFailure): Promise<void> => {
      const connection = connectionHarness((sql, values) =>
        normalizeSql(sql) === DUPLICATE_SQL
          ? Promise.reject(providerError)
          : defaultQueryResult(sql, values),
      );
      const program = transactionProgram(async (context) => {
        try {
          await context.executeStatement(duplicateStatement, ['candidate']);
        } catch {
          // The program cannot select settlement after its statement is poisoned.
        }

        return Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>;
      });
      const { executor } = executorHarness(program, [connection]);

      await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
        kind: 'not-committed',
        failure: expectedFailure,
      });
      expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
      expect(sqlTrace(connection)).not.toContain(COMMIT);
    },
  );

  it('uses captured authority lookups when collection prototypes are polluted', async (): Promise<void> => {
    const connection = connectionHarness((sql, values) =>
      normalizeSql(sql) === DUPLICATE_SQL
        ? Promise.reject(duplicateError())
        : defaultQueryResult(sql, values),
    );
    const program = transactionProgram(async (context) => {
      try {
        await context.executeStatement(duplicateStatement, ['candidate']);
      } catch {
        // The exact mapped failure remains sticky.
      }

      return Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>;
    });
    const { executor } = executorHarness(program, [connection]);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restored in finally and invoked only through Reflect.apply.
    const originalSetHas = Set.prototype.has;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restored in finally and invoked only through Reflect.apply.
    const originalMapGet = Map.prototype.get;

    Object.defineProperty(Set.prototype, 'has', {
      configurable: true,
      value(this: Set<unknown>, value: unknown): boolean {
        if (value === duplicateStatement) throw new Error('polluted Set.has');
        return Reflect.apply(originalSetHas, this, [value]);
      },
      writable: true,
    });
    Object.defineProperty(Map.prototype, 'get', {
      configurable: true,
      value(this: Map<unknown, unknown>, key: unknown): unknown {
        if (key === 'uq_executor_probe_value') throw new Error('polluted Map.get');
        return Reflect.apply(originalMapGet, this, [key]);
      },
      writable: true,
    });

    try {
      await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
        kind: 'not-committed',
        failure: 'collision',
      });
    } finally {
      Object.defineProperty(Set.prototype, 'has', {
        configurable: true,
        value: originalSetHas,
        writable: true,
      });
      Object.defineProperty(Map.prototype, 'get', {
        configurable: true,
        value: originalMapGet,
        writable: true,
      });
    }

    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
  });

  it('never converts a rejected COMMIT into rollback or a retry', async (): Promise<void> => {
    const connection = connectionHarness((sql, values) =>
      normalizeSql(sql) === COMMIT
        ? Promise.reject(new Error('ambiguous commit provider detail'))
        : defaultQueryResult(sql, values),
    );
    const run = jest.fn((context: ProgramContext, input: ProgramInput) =>
      Promise.resolve(context.requestCommit(Object.freeze({ value: input.value }))),
    );
    const { executor, getConnection } = executorHarness(transactionProgram(run), [connection]);

    await expect(executor.execute({ value: 'ambiguous' })).resolves.toEqual({
      kind: 'indeterminate',
    });
    expect(sqlTrace(connection).filter((sql) => sql === COMMIT)).toHaveLength(1);
    expect(sqlTrace(connection)).not.toContain(ROLLBACK);
    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('quarantines a timed-out COMMIT and keeps its settlement indeterminate', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const pendingCommit = deferred<unknown>();
      const connection = connectionHarness((sql, values) =>
        normalizeSql(sql) === COMMIT ? pendingCommit.promise : defaultQueryResult(sql, values),
      );
      const program = transactionProgram((context, input) =>
        Promise.resolve(context.requestCommit(Object.freeze({ value: input.value }))),
      );
      const { executor, getConnection } = executorHarness(program, [connection], 1_000);
      const execution = executor.execute({ value: 'possibly-durable' });

      await flushUntil(
        () => sqlTrace(connection).includes(COMMIT),
        'The commit request did not start',
      );
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(execution).resolves.toEqual({ kind: 'indeterminate' });
      expect(sqlTrace(connection).filter((sql) => sql === COMMIT)).toHaveLength(1);
      expect(sqlTrace(connection)).not.toContain(ROLLBACK);
      expect(getConnection).toHaveBeenCalledTimes(1);
      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(connection.release).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not downgrade acknowledged COMMIT when transport retirement fails', async (): Promise<void> => {
    const connection = connectionHarness(defaultQueryResult, () =>
      Promise.reject(new Error('release provider detail')),
    );
    const program = transactionProgram((context, input) =>
      Promise.resolve(context.requestCommit(Object.freeze({ value: input.value }))),
    );
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'durable' })).resolves.toEqual({
      kind: 'committed',
      result: { value: 'durable' },
    });
    expect(sqlTrace(connection).at(-1)).toBe(COMMIT);
    expect(sqlTrace(connection)).not.toContain(ROLLBACK);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['completed session-close proof', false, { kind: 'not-committed', failure: 'requested' }],
    ['failed session-close proof', true, { kind: 'indeterminate' }],
  ] as const)(
    'classifies rejected ROLLBACK with %s',
    async (_scenario, rejectRelease, expectedOutcome): Promise<void> => {
      const connection = connectionHarness(
        (sql, values) =>
          normalizeSql(sql) === ROLLBACK
            ? Promise.reject(new Error('rollback provider detail'))
            : defaultQueryResult(sql, values),
        rejectRelease
          ? (): Promise<void> => Promise.reject(new Error('closure provider detail'))
          : (): Promise<void> => Promise.resolve(),
      );
      const program = transactionProgram((context) =>
        Promise.resolve(context.requestRollback('requested')),
      );
      const { executor } = executorHarness(program, [connection]);

      await expect(executor.execute({ value: 'unused' })).resolves.toEqual(expectedOutcome);
      expect(sqlTrace(connection).filter((sql) => sql === ROLLBACK)).toHaveLength(1);
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(connection.destroy).toHaveBeenCalledTimes(rejectRelease ? 1 : 0);
    },
  );

  it('makes a caught concurrent statement violation sticky and rolls back after drain', async (): Promise<void> => {
    const pendingStatement = deferred<unknown>();
    const connection = connectionHarness((sql, values) =>
      normalizeSql(sql) === VALUE_SQL ? pendingStatement.promise : defaultQueryResult(sql, values),
    );
    let concurrentRejected = false;
    const program = transactionProgram(async (context) => {
      const first = context.executeStatement(valueStatement, ['first']);

      try {
        void context.executeStatement(valueStatement, ['second']);
      } catch {
        concurrentRejected = true;
      }

      await first;
      return Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>;
    });
    const { executor } = executorHarness(program, [connection]);
    const execution = executor.execute({ value: 'unused' });

    await flushUntil(
      () => sqlTrace(connection).includes(VALUE_SQL),
      'The first statement did not start',
    );
    expect(sqlTrace(connection).filter((sql) => sql === VALUE_SQL)).toHaveLength(1);
    expect(sqlTrace(connection)).not.toContain(ROLLBACK);

    pendingStatement.resolve([{ value: 'first' }]);

    await expect(execution).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(concurrentRejected).toBe(true);
    expect(sqlTrace(connection).filter((sql) => sql === VALUE_SQL)).toHaveLength(1);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
  });

  it('registers statement ownership before the driver can synchronously re-enter', async (): Promise<void> => {
    let context: ProgramContext | undefined;
    let reentryRejected = false;
    const connection = connectionHarness((sql, values) => {
      if (normalizeSql(sql) === VALUE_SQL && !reentryRejected) {
        try {
          void context?.executeStatement(valueStatement, ['reentrant']);
        } catch {
          reentryRejected = true;
        }
      }

      return defaultQueryResult(sql, values);
    });
    const program = transactionProgram(async (programContext) => {
      context = programContext;
      await programContext.executeStatement(valueStatement, ['first']);
      return Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>;
    });
    const { executor } = executorHarness(program, [connection]);

    await expect(executor.execute({ value: 'unused' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(reentryRejected).toBe(true);
    expect(sqlTrace(connection).filter((sql) => sql === VALUE_SQL)).toHaveLength(1);
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(sqlTrace(connection)).not.toContain(COMMIT);
  });

  it('detects floated work, drains it before rollback, and rejects escaped session use', async (): Promise<void> => {
    const pendingStatement = deferred<unknown>();
    const connection = connectionHarness((sql, values) =>
      normalizeSql(sql) === VALUE_SQL ? pendingStatement.promise : defaultQueryResult(sql, values),
    );
    let escapedContext: ProgramContext | undefined;
    const program = transactionProgram((context) => {
      escapedContext = context;
      void context.executeStatement(valueStatement, ['floated']).catch(() => undefined);
      return Promise.resolve(Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>);
    });
    const { executor } = executorHarness(program, [connection]);
    const execution = executor.execute({ value: 'unused' });
    let settled = false;
    void execution.then((): void => {
      settled = true;
    });

    await flushUntil(
      () => sqlTrace(connection).includes(VALUE_SQL),
      'The floated statement did not start',
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(sqlTrace(connection)).not.toContain(ROLLBACK);

    pendingStatement.resolve([{ value: 'floated' }]);

    await expect(execution).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(sqlTrace(connection).at(-1)).toBe(ROLLBACK);
    expect(escapedContext).toBeDefined();
    expect(() => escapedContext?.executeStatement(valueStatement, ['escaped'])).toThrow(
      'Invalid MySQL transaction program transition',
    );
    expect(sqlTrace(connection).filter((sql) => sql === VALUE_SQL)).toHaveLength(1);
  });

  it('rejects a directive minted by a foreign concurrent execution', async (): Promise<void> => {
    const firstConnection = connectionHarness();
    const secondConnection = connectionHarness();
    const firstGate = deferred<undefined>();
    let firstDirective: MySqlTransactionDirective<CommitResult, Failure> | undefined;
    const program = transactionProgram(async (context, input) => {
      if (input.mode === 'owner') {
        firstDirective = context.requestRollback('requested');
        await firstGate.promise;
        return firstDirective;
      }

      if (firstDirective === undefined) {
        throw new Error('The test expected the foreign directive to exist');
      }

      return firstDirective;
    });
    const { executor, getConnection } = executorHarness(program, [
      firstConnection,
      secondConnection,
    ]);
    const rightfulExecution = executor.execute({ mode: 'owner', value: 'first' });

    await flushUntil(() => firstDirective !== undefined, 'The rightful directive was not minted');

    await expect(executor.execute({ mode: 'foreign', value: 'second' })).resolves.toEqual({
      kind: 'not-committed',
      failure: 'defect',
    });
    expect(sqlTrace(secondConnection).at(-1)).toBe(ROLLBACK);

    firstGate.resolve(undefined);
    await expect(rightfulExecution).resolves.toEqual({
      kind: 'not-committed',
      failure: 'requested',
    });
    expect(sqlTrace(firstConnection).at(-1)).toBe(ROLLBACK);
    expect(getConnection).toHaveBeenCalledTimes(2);
  });

  it('uses one absolute setup deadline and quarantines the exact lease once', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const firstSetup = deferred<unknown>();
      const secondSetup = deferred<unknown>();
      const connection = connectionHarness((sql, values) => {
        const normalized = normalizeSql(sql);

        if (normalized === SET_UTC) return firstSetup.promise;
        if (normalized === SET_READ_COMMITTED) return secondSetup.promise;
        return defaultQueryResult(sql, values);
      });
      const run = jest.fn((context: ProgramContext) =>
        Promise.resolve(context.requestRollback('requested')),
      );
      const { executor } = executorHarness(transactionProgram(run), [connection], 1_000);
      const execution = executor.execute({ value: 'unused' });

      await flushUntil(
        () => sqlTrace(connection).includes(SET_UTC),
        'The first setup operation did not start',
      );
      await jest.advanceTimersByTimeAsync(600);
      firstSetup.resolve({});
      await flushUntil(
        () => sqlTrace(connection).includes(SET_READ_COMMITTED),
        'The second setup operation did not start',
      );

      await jest.advanceTimersByTimeAsync(399);
      expect(connection.destroy).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);

      await expect(execution).resolves.toEqual({
        kind: 'not-committed',
        failure: 'unavailable',
      });
      expect(run).not.toHaveBeenCalled();
      expect(sqlTrace(connection)).toEqual([SET_UTC, SET_READ_COMMITTED]);
      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(connection.release).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses monotonic time when the event loop delays the timer callback past the deadline', async (): Promise<void> => {
    const connection = connectionHarness();
    const program = transactionProgram((context, input) => {
      const waitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      Atomics.wait(waitCell, 0, 0, 1_100);
      return Promise.resolve(context.requestCommit(Object.freeze({ value: input.value })));
    });
    const { executor } = executorHarness(program, [connection], 1_000);

    await expect(executor.execute({ value: 'too-late' })).resolves.toEqual({
      kind: 'indeterminate',
    });
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(sqlTrace(connection)).not.toContain(COMMIT);
    expect(sqlTrace(connection)).not.toContain(ROLLBACK);
  });

  it('invokes the settlement observer once when the program fulfills after its deadline outcome', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const programGate = deferred<undefined>();
      const connection = connectionHarness();
      const input = Object.freeze({ value: 'late-fulfillment' });
      let runStarted = false;
      let observerCalls = 0;
      let observedInput: ProgramInput | undefined;
      let receiverWasUndefined = false;
      const program = transactionProgram(
        (context, programInput) => {
          runStarted = true;
          const directive = context.requestCommit(Object.freeze({ value: programInput.value }));

          return programGate.promise.then(() => directive);
        },
        function observeProgramSettlement(this: undefined, programInput): undefined {
          observerCalls += 1;
          observedInput = programInput;
          receiverWasUndefined = (this as unknown) === undefined;
          return undefined;
        },
      );
      const { executor } = executorHarness(program, [connection], 1_000);
      const execution = executor.execute(input);

      await flushUntil(() => runStarted, 'The deadline-bound program did not start');
      expect(observerCalls).toBe(0);

      await jest.advanceTimersByTimeAsync(1_000);

      await expect(execution).resolves.toEqual({ kind: 'indeterminate' });
      expect(observerCalls).toBe(0);
      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(connection.release).not.toHaveBeenCalled();
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(sqlTrace(connection)).not.toContain(ROLLBACK);

      programGate.resolve(undefined);
      await flushUntil(() => observerCalls === 1, 'The late program settlement was not observed');
      await Promise.resolve();

      expect(observerCalls).toBe(1);
      expect(observedInput).toBe(input);
      expect(receiverWasUndefined).toBe(true);
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(sqlTrace(connection)).not.toContain(ROLLBACK);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('contains a rejected async observer after an already-returned deadline outcome', async (): Promise<void> => {
    jest.useFakeTimers();
    const unhandledReasons: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const programGate = deferred<undefined>();
      const connection = connectionHarness();
      let runStarted = false;
      let observerCalls = 0;
      const nonContractObserver = ((): Promise<never> => {
        observerCalls += 1;
        return Promise.reject(new Error('late async settlement observer secret'));
      }) as unknown as ProgramSettlementObserver;
      const program = transactionProgram(async (context, input) => {
        runStarted = true;
        await programGate.promise;
        return context.requestCommit(Object.freeze({ value: input.value }));
      }, nonContractObserver);
      const { executor } = executorHarness(program, [connection], 1_000);
      const execution = executor.execute({ value: 'late-async-observer' });

      await flushUntil(() => runStarted, 'The late async-observer program did not start');
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(execution).resolves.toEqual({ kind: 'indeterminate' });
      expect(observerCalls).toBe(0);

      programGate.resolve(undefined);
      await flushUntil(() => observerCalls === 1, 'The late async observer was not invoked');
      await Promise.resolve();

      expect(observerCalls).toBe(1);
      expect(unhandledReasons).toEqual([]);
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(sqlTrace(connection)).not.toContain(ROLLBACK);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      jest.useRealTimers();
    }
  });

  it('defers a post-deadline observer until the exact floated statement drains', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const pendingStatement = deferred<unknown>();
      const connection = connectionHarness((sql, values) =>
        normalizeSql(sql) === VALUE_SQL
          ? pendingStatement.promise
          : defaultQueryResult(sql, values),
      );
      let observerCalls = 0;
      const program = transactionProgram(
        (context) => {
          void context
            .executeStatement(valueStatement, ['post-deadline-floated'])
            .catch(() => undefined);
          return Promise.resolve(
            Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>,
          );
        },
        (): undefined => {
          observerCalls += 1;
          return undefined;
        },
      );
      const { executor } = executorHarness(program, [connection], 1_000);
      const execution = executor.execute({ value: 'post-deadline-floated' });

      await flushUntil(
        () => sqlTrace(connection).includes(VALUE_SQL),
        'The post-deadline floated statement did not start',
      );
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(execution).resolves.toEqual({ kind: 'indeterminate' });
      expect(observerCalls).toBe(0);
      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(sqlTrace(connection)).not.toContain(ROLLBACK);

      pendingStatement.resolve([{ value: 'post-deadline-floated' }]);
      await flushUntil(
        () => observerCalls === 1,
        'The observer ran before the floated statement drained',
      );
      await Promise.resolve();

      expect(observerCalls).toBe(1);
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(sqlTrace(connection)).not.toContain(ROLLBACK);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns indeterminate and quarantines floated work at the deadline', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const pendingStatement = deferred<unknown>();
      const connection = connectionHarness((sql, values) =>
        normalizeSql(sql) === VALUE_SQL
          ? pendingStatement.promise
          : defaultQueryResult(sql, values),
      );
      const program = transactionProgram((context) => {
        void context.executeStatement(valueStatement, ['stalled']).catch(() => undefined);
        return Promise.resolve(
          Object.freeze({}) as MySqlTransactionDirective<CommitResult, Failure>,
        );
      });
      const { executor } = executorHarness(program, [connection], 1_000);
      const execution = executor.execute({ value: 'unused' });

      await flushUntil(
        () => sqlTrace(connection).includes(VALUE_SQL),
        'The stalled statement did not start',
      );
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(execution).resolves.toEqual({ kind: 'indeterminate' });
      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(connection.release).not.toHaveBeenCalled();
      expect(sqlTrace(connection)).not.toContain(COMMIT);
      expect(sqlTrace(connection)).not.toContain(ROLLBACK);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

// @ts-expect-error Program settlement observation must complete synchronously with undefined.
const _asyncObserver: ProgramSettlementObserver = () => Promise.resolve(undefined);
void _asyncObserver;
