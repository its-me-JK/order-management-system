import type { DatabaseRuntime } from '../src/database.contract';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createPrismaDatabaseRuntime, getPrismaClient } from '../src/prisma-database.runtime';

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
});
