import { createPrismaClient } from './client/prisma-client.factory';
import type { DatabaseConnectionOptions, DatabaseRuntime } from './database.contract';
import { createPrismaDatabaseRuntime } from './prisma-database.runtime';

export function createDatabaseRuntime(options: DatabaseConnectionOptions): DatabaseRuntime {
  return createPrismaDatabaseRuntime(createPrismaClient(options), options.probeTimeoutMilliseconds);
}
