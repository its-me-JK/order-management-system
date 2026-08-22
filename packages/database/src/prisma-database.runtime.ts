import { PrismaDatabaseDriver } from './client/prisma-database.driver';
import { ManagedDatabaseConnection } from './database.connection';
import type { DatabaseRuntime } from './database.contract';
import type { PrismaClient } from './generated/prisma/client';

const runtimeClients = new WeakMap<DatabaseRuntime, PrismaClient>();

class ManagedPrismaDatabaseRuntime implements DatabaseRuntime {
  public readonly connection: ManagedDatabaseConnection;

  public constructor(client: PrismaClient, probeTimeoutMilliseconds: number) {
    this.connection = new ManagedDatabaseConnection(
      new PrismaDatabaseDriver(client),
      probeTimeoutMilliseconds,
    );
    runtimeClients.set(this, client);
  }

  public close(): Promise<void> {
    return this.connection.close();
  }
}

/**
 * Creates a runtime around an existing client without creating another pool.
 * Intended for composition roots and focused infrastructure tests.
 */
export function createPrismaDatabaseRuntime(
  client: PrismaClient,
  probeTimeoutMilliseconds = 1_000,
): DatabaseRuntime {
  return new ManagedPrismaDatabaseRuntime(client, probeTimeoutMilliseconds);
}

/**
 * Recovers the concrete client owned by a runtime created by this package.
 */
export function getPrismaClient(runtime: DatabaseRuntime): PrismaClient {
  const client = runtimeClients.get(runtime);

  if (client === undefined) {
    throw new TypeError('Database runtime is not backed by a Prisma client');
  }

  return client;
}
