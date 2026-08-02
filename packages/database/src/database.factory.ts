import { createPrismaDatabaseDriver } from './client/prisma-database.driver';
import { ManagedDatabaseConnection } from './database.connection';
import type { DatabaseConnection, DatabaseConnectionOptions } from './database.contract';

export function createDatabase(options: DatabaseConnectionOptions): DatabaseConnection {
  return new ManagedDatabaseConnection(
    createPrismaDatabaseDriver(options),
    options.probeTimeoutMilliseconds,
  );
}
