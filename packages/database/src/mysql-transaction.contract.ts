import type { DatabaseRuntime } from './database.contract';

export type MySqlTransactionParameter = null | string | number | bigint | boolean | Uint8Array;

declare const mySqlTransactionStatementBrand: unique symbol;
declare const mySqlTransactionDirectiveBrand: unique symbol;

/** Opaque static statement identity; SQL and mappings remain registry-private. */
export type MySqlTransactionStatement<
  Parameters extends readonly MySqlTransactionParameter[],
  Result,
  Failure extends string,
> = Readonly<{
  readonly [mySqlTransactionStatementBrand]: Readonly<{
    parameters: Parameters;
    result: Result;
    failure: Failure;
  }>;
}>;

export type AnyMySqlTransactionStatement<Failure extends string> = MySqlTransactionStatement<
  readonly MySqlTransactionParameter[],
  unknown,
  Failure
>;

export type MySqlTransactionStatementParameters<Statement> =
  Statement extends MySqlTransactionStatement<infer Parameters, unknown, string>
    ? Parameters
    : never;

export type MySqlTransactionStatementResult<Statement> =
  Statement extends MySqlTransactionStatement<
    readonly MySqlTransactionParameter[],
    infer Result,
    string
  >
    ? Result
    : never;

export type MySqlTransactionStatementDefinition<
  Parameters extends readonly MySqlTransactionParameter[],
  Result,
  Failure extends string,
> = Readonly<{
  text: string;
  parameterCount: Parameters['length'];
  decode(this: undefined, value: unknown): Result;
  duplicateKeyFailures?: Readonly<Record<string, Failure>>;
}>;

/** Runtime-authentic request bound to one active execution; it is not settlement proof. */
export type MySqlTransactionDirective<CommitResult, Failure extends string> = Readonly<{
  readonly [mySqlTransactionDirectiveBrand]: Readonly<{
    commitResult: CommitResult;
    failure: Failure;
  }>;
}>;

export interface MySqlTransactionProgramContext<
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
> {
  executeStatement<Statement extends Statements>(
    statement: Statement,
    parameters: MySqlTransactionStatementParameters<Statement>,
  ): Promise<MySqlTransactionStatementResult<Statement>>;

  requestCommit(result: CommitResult): MySqlTransactionDirective<CommitResult, Failure>;

  requestRollback(failure: Failure): MySqlTransactionDirective<CommitResult, Failure>;
}

export type MySqlTransactionProgram<
  Input,
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
> = Readonly<{
  statements: readonly Statements[];
  failures: readonly Failure[];
  unavailableFailure: Failure;
  defectFailure: Failure;
  /**
   * Optional synchronous notification that the exact program Promise settled.
   * The executor invokes it receiver-free only after sealing statement authority
   * and draining the exact tracked statement operation, if one existed.
   * It must return undefined synchronously; any other runtime return is a defect.
   */
  observeProgramSettlement?(this: undefined, input: Input): undefined;
  run(
    this: undefined,
    context: MySqlTransactionProgramContext<CommitResult, Failure, Statements>,
    input: Input,
  ): Promise<MySqlTransactionDirective<CommitResult, Failure>>;
}>;

export type MySqlTransactionOutcome<CommitResult, Failure extends string> =
  | Readonly<{
      kind: 'committed';
      result: CommitResult;
    }>
  | Readonly<{
      kind: 'not-committed';
      failure: Failure;
    }>
  | Readonly<{
      kind: 'indeterminate';
    }>;

export type MySqlTransactionExecutorOptions = Readonly<{
  timeoutMilliseconds: number;
}>;

export interface MySqlTransactionExecutor<Input, CommitResult, Failure extends string> {
  execute(input: Input): Promise<MySqlTransactionOutcome<CommitResult, Failure>>;
}

export type CreateMySqlTransactionExecutor = <
  Input,
  CommitResult,
  Failure extends string,
  Statements extends AnyMySqlTransactionStatement<Failure>,
>(
  runtime: DatabaseRuntime,
  program: MySqlTransactionProgram<Input, CommitResult, Failure, Statements>,
  options: MySqlTransactionExecutorOptions,
) => MySqlTransactionExecutor<Input, CommitResult, Failure>;
