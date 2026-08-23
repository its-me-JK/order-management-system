import type { DatabaseRuntime } from '../src/database.contract';
import type { PrismaClient } from '../src/generated/prisma/client';
import { ManagedMariaDbConnectionLeaseOwner } from '../src/client/managed-mariadb-connection-lease.owner';
import {
  createDatabaseResourcesRuntime,
  createPrismaDatabaseRuntime,
  getPrismaClient,
  getRuntimeMariaDbConnectionLeaseOwner,
} from '../src/prisma-database.runtime';

interface PrismaClientLifecycleMock {
  readonly $disconnect: jest.MockedFunction<() => Promise<void>>;
  readonly $queryRaw: jest.MockedFunction<() => Promise<readonly unknown[]>>;
}

function prismaClient(): {
  readonly client: PrismaClient;
  readonly lifecycle: PrismaClientLifecycleMock;
} {
  const lifecycle: PrismaClientLifecycleMock = {
    $disconnect: jest.fn((): Promise<void> => Promise.resolve()),
    $queryRaw: jest.fn((): Promise<readonly unknown[]> => Promise.resolve([])),
  };

  return {
    client: lifecycle as unknown as PrismaClient,
    lifecycle,
  };
}

describe('Prisma database runtime', (): void => {
  it('exposes the single client used by its lifecycle connection', async (): Promise<void> => {
    const { client, lifecycle } = prismaClient();
    const runtime = createPrismaDatabaseRuntime(client);

    expect(getPrismaClient(runtime)).toBe(client);

    await expect(runtime.connection.probe()).resolves.toBeUndefined();
    expect(lifecycle.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('shares one idempotent shutdown across runtime and connection callers', async (): Promise<void> => {
    const { client, lifecycle } = prismaClient();
    const runtime = createPrismaDatabaseRuntime(client);

    const runtimeClose = runtime.close();
    const connectionClose = runtime.connection.close();

    expect(runtimeClose).toBe(connectionClose);
    await expect(Promise.all([runtimeClose, connectionClose])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(lifecycle.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects runtimes that do not own a Prisma client', (): void => {
    const runtime: DatabaseRuntime = {
      close: (): Promise<void> => Promise.resolve(),
      connection: {
        close: (): Promise<void> => Promise.resolve(),
        probe: (): Promise<void> => Promise.resolve(),
      },
    };

    expect((): PrismaClient => getPrismaClient(runtime)).toThrow(
      'Database runtime is not backed by a Prisma client',
    );
  });

  it('binds one exact direct-connection owner only to its production runtime identity', async (): Promise<void> => {
    const { client } = prismaClient();
    const firstOwner = new ManagedMariaDbConnectionLeaseOwner(
      (): never => {
        throw new Error('unused allocator must stay lazy');
      },
      Object.freeze({ connectionLimit: 2 }),
    );
    const secondOwner = new ManagedMariaDbConnectionLeaseOwner(
      (): never => {
        throw new Error('unused allocator must stay lazy');
      },
      Object.freeze({ connectionLimit: 2 }),
    );
    const firstRuntime = createDatabaseResourcesRuntime(client, firstOwner);
    const secondRuntime = createDatabaseResourcesRuntime(prismaClient().client, secondOwner);

    expect(getRuntimeMariaDbConnectionLeaseOwner(firstRuntime)).toBe(firstOwner);
    expect(getRuntimeMariaDbConnectionLeaseOwner(secondRuntime)).toBe(secondOwner);
    expect(getRuntimeMariaDbConnectionLeaseOwner(firstRuntime)).not.toBe(
      getRuntimeMariaDbConnectionLeaseOwner(secondRuntime),
    );

    await expect(firstRuntime.close()).resolves.toBeUndefined();
    await expect(secondRuntime.close()).resolves.toBeUndefined();
  });

  it('does not grant direct-connection authority to fixtures or forged runtimes', (): void => {
    const fixtureRuntime = createPrismaDatabaseRuntime(prismaClient().client);
    const forgedRuntime: DatabaseRuntime = {
      close: (): Promise<void> => Promise.resolve(),
      connection: {
        close: (): Promise<void> => Promise.resolve(),
        probe: (): Promise<void> => Promise.resolve(),
      },
    };

    expect(() => getRuntimeMariaDbConnectionLeaseOwner(fixtureRuntime)).toThrow(
      'Database runtime has no direct MariaDB connection authority',
    );
    expect(() => getRuntimeMariaDbConnectionLeaseOwner(forgedRuntime)).toThrow(
      'Database runtime has no direct MariaDB connection authority',
    );
  });
});
