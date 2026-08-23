import { createPrismaClient } from './client/prisma-client.factory';
import { createManagedMariaDbConnectionAllocator } from './client/mariadb-transaction-connection-allocator.factory';
import { toMariaDbTransactionConnectionAllocatorOptions } from './client/mariadb-transaction-connection-allocator.options';
import { ManagedMariaDbConnectionLeaseOwner } from './client/managed-mariadb-connection-lease.owner';
import type { DatabaseConnectionOptions, DatabaseRuntime } from './database.contract';
import { createDatabaseResourcesRuntime } from './prisma-database.runtime';

export function createDatabaseRuntime(options: DatabaseConnectionOptions): DatabaseRuntime {
  const mariaDbConnectionAllocatorOptions = toMariaDbTransactionConnectionAllocatorOptions(options);
  const mariaDbConnectionLeaseOwner = new ManagedMariaDbConnectionLeaseOwner(
    createManagedMariaDbConnectionAllocator,
    mariaDbConnectionAllocatorOptions,
  );

  return createDatabaseResourcesRuntime(
    createPrismaClient(options),
    mariaDbConnectionLeaseOwner,
    options.probeTimeoutMilliseconds,
  );
}
