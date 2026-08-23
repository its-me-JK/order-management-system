import type { ConnectionConfig, LoggerConfig } from 'mariadb';

import type { DatabaseConnectionOptions } from '../database.contract';
import { databaseConnectionBudget } from './database-connection-budget';

const discardMessage = (): void => undefined;

const SILENT_DRIVER_LOGGER: Readonly<LoggerConfig> = Object.freeze({
  // The connector otherwise falls back to console.log for warnings. Network
  // and query callbacks stay absent because their presence enables formatting.
  warning: discardMessage,
});

export type MariaDbOwnedConnectionConfig = Readonly<
  Omit<ConnectionConfig, 'host' | 'port'> & {
    host: string;
    port: number;
    /** Pinned 3.4.5 supports this option but omits it from its declarations. */
    permitRedirect: false;
  }
>;

export interface MariaDbTransactionConnectionAllocatorOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly connection: MariaDbOwnedConnectionConfig;
  readonly connectionLimit: number;
}

/** Maps the exact-transaction slice into a bounded direct-connection allocator. */
export function toMariaDbTransactionConnectionAllocatorOptions(
  options: DatabaseConnectionOptions,
): Readonly<MariaDbTransactionConnectionAllocatorOptions> {
  const budget = databaseConnectionBudget(options);
  const connection = Object.freeze({
    allowPublicKeyRetrieval: false,
    bigIntAsNumber: false,
    bulk: false,
    checkNumberRange: true,
    connectTimeout: options.connectTimeoutMilliseconds,
    database: options.database,
    dateStrings: true,
    debug: false,
    debugCompress: false,
    decimalAsNumber: false,
    foundRows: false,
    host: options.host,
    insertIdAsNumber: false,
    logger: SILENT_DRIVER_LOGGER,
    logPackets: false,
    logParam: false,
    multipleStatements: false,
    namedPlaceholders: false,
    permitLocalInfile: false,
    permitRedirect: false,
    permitSetMultiParamEntries: false,
    pipelining: false,
    port: options.port,
    prepareCacheLength: 0,
    timezone: 'Z',
    trace: false,
    ...(options.tls.enabled
      ? {
          ssl: Object.freeze({
            minVersion: 'TLSv1.2' as const,
            rejectUnauthorized: true,
            ...(options.tls.certificateAuthority === undefined
              ? {}
              : { ca: options.tls.certificateAuthority }),
          }),
        }
      : {}),
    user: options.user,
    password: options.password,
  }) satisfies MariaDbOwnedConnectionConfig;

  return Object.freeze({
    acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
    connection,
    connectionLimit: budget.transactionConnectionLimit,
  });
}
