import type { DatabaseConnectionOptions } from '../database.contract';

export interface DatabaseConnectionBudget {
  readonly prismaConnectionLimit: number;
  readonly transactionConnectionLimit: number;
  readonly totalConnectionLimit: number;
}

export function databaseConnectionBudget(
  options: Pick<DatabaseConnectionOptions, 'connectionLimit' | 'transactionConnectionLimit'>,
): DatabaseConnectionBudget {
  const totalConnectionLimit = options.connectionLimit;
  const transactionConnectionLimit = options.transactionConnectionLimit;

  if (
    !Number.isInteger(totalConnectionLimit) ||
    !Number.isInteger(transactionConnectionLimit) ||
    totalConnectionLimit < 2 ||
    totalConnectionLimit > 50 ||
    transactionConnectionLimit < 1 ||
    transactionConnectionLimit >= totalConnectionLimit
  ) {
    throw new TypeError('Invalid database connection budget');
  }

  return Object.freeze({
    prismaConnectionLimit: totalConnectionLimit - transactionConnectionLimit,
    totalConnectionLimit,
    transactionConnectionLimit,
  });
}
