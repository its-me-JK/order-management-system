import { PrismaDatabaseDriver } from './client/prisma-database.driver';
import type { ManagedMariaDbConnectionLeaseOwner } from './client/managed-mariadb-connection-lease.owner';
import { ManagedDatabaseConnection } from './database.connection';
import type { DatabaseRuntime } from './database.contract';
import type { PrismaClient } from './generated/prisma/client';

const runtimeClients = new WeakMap<DatabaseRuntime, PrismaClient>();
const runtimeMariaDbConnectionLeaseOwners = new WeakMap<
  DatabaseRuntime,
  ManagedMariaDbConnectionLeaseOwner<unknown>
>();

class ManagedPrismaDatabaseRuntime implements DatabaseRuntime {
  public readonly connection: ManagedDatabaseConnection;

  public constructor(
    client: PrismaClient,
    probeTimeoutMilliseconds: number,
    mariaDbConnectionLeaseOwner?: ManagedMariaDbConnectionLeaseOwner<unknown>,
  ) {
    this.connection = new ManagedDatabaseConnection(
      new PrismaDatabaseDriver(client, mariaDbConnectionLeaseOwner),
      probeTimeoutMilliseconds,
    );
    runtimeClients.set(this, client);

    if (mariaDbConnectionLeaseOwner !== undefined) {
      runtimeMariaDbConnectionLeaseOwners.set(this, mariaDbConnectionLeaseOwner);
    }
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

/** @internal Creates a production runtime with its direct connection lease owner. */
export function createDatabaseResourcesRuntime<AllocatorOptions>(
  client: PrismaClient,
  mariaDbConnectionLeaseOwner: ManagedMariaDbConnectionLeaseOwner<AllocatorOptions>,
  probeTimeoutMilliseconds = 1_000,
): DatabaseRuntime {
  return new ManagedPrismaDatabaseRuntime(
    client,
    probeTimeoutMilliseconds,
    mariaDbConnectionLeaseOwner as ManagedMariaDbConnectionLeaseOwner<unknown>,
  );
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

/** @internal Recovers only the direct owner registered by the production factory. */
export function getRuntimeMariaDbConnectionLeaseOwner(
  runtime: DatabaseRuntime,
): ManagedMariaDbConnectionLeaseOwner<unknown> {
  const owner = runtimeMariaDbConnectionLeaseOwners.get(runtime);

  if (owner === undefined) {
    throw new TypeError('Database runtime has no direct MariaDB connection authority');
  }

  return owner;
}
