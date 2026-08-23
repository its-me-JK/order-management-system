/**
 * Infrastructure-only exact-connection MySQL transaction boundary.
 *
 * Business-module infrastructure may define a fixed reviewed program through
 * this subpath. Application and domain code must continue to depend on their
 * module-owned ports.
 */
export { createMySqlTransactionExecutor } from './client/managed-mysql-transaction.executor';
export { defineMySqlTransactionStatement } from './mysql-transaction.statement';
export type {
  AnyMySqlTransactionStatement,
  CreateMySqlTransactionExecutor,
  MySqlTransactionDirective,
  MySqlTransactionExecutor,
  MySqlTransactionExecutorOptions,
  MySqlTransactionInstant,
  MySqlTransactionOutcome,
  MySqlTransactionParameter,
  MySqlTransactionProgram,
  MySqlTransactionProgramContext,
  MySqlTransactionStatement,
  MySqlTransactionStatementDefinition,
  MySqlTransactionStatementParameters,
  MySqlTransactionStatementResult,
} from './mysql-transaction.contract';
