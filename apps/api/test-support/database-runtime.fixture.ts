import type { DatabaseConnection, DatabaseRuntime } from '@oms/database';
import { createPrismaDatabaseRuntime, type PrismaClient } from '@oms/database/prisma';

export function createDatabaseRuntimeFixture(connection: DatabaseConnection): DatabaseRuntime {
  const client = {
    $disconnect: (): Promise<void> => connection.close(),
    $queryRaw: (): Promise<void> => connection.probe(),
  } as unknown as PrismaClient;

  return createPrismaDatabaseRuntime(client);
}
