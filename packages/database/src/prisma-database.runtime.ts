import { PrismaDatabaseDriver } from './client/prisma-database.driver';
import { ManagedDatabaseConnection } from './database.connection';
import type { DatabaseRuntime } from './database.contract';
import type { PrismaClient } from './generated/prisma/client';

const clients = new WeakMap<DatabaseRuntime, PrismaClient>();

class PrismaDatabaseRuntime implements DatabaseRuntime {
  public readonly connection: ManagedDatabaseConnection;

  public constructor(client: PrismaClient, probeTimeoutMilliseconds: number) {
    this.connection = new ManagedDatabaseConnection(
      new PrismaDatabaseDriver(client),
      probeTimeoutMilliseconds,
    );
    clients.set(this, client);
  }

  public close(): Promise<void> {
    return this.connection.close();
  }
}

export function createPrismaDatabaseRuntime(
  client: PrismaClient,
  probeTimeoutMilliseconds = 1_000,
): DatabaseRuntime {
  return new PrismaDatabaseRuntime(client, probeTimeoutMilliseconds);
}

export function getPrismaClient(runtime: DatabaseRuntime): PrismaClient {
  const client = clients.get(runtime);

  if (client === undefined) {
    throw new TypeError('Database runtime is not backed by a Prisma client');
  }

  return client;
}
