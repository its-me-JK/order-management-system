import {
  PrismaDatabaseDriver,
  type AuxiliaryDatabaseResourceOwner,
} from '../src/client/prisma-database.driver';
import type { PrismaClient } from '../src/generated/prisma/client';

interface PrismaClientLifecycleMock {
  readonly $disconnect: jest.MockedFunction<() => Promise<void>>;
  readonly $queryRaw: jest.MockedFunction<() => Promise<readonly unknown[]>>;
}

interface AuxiliaryOwnerHarness {
  readonly beginClose: jest.MockedFunction<() => void>;
  readonly close: jest.MockedFunction<() => Promise<void>>;
  readonly owner: AuxiliaryDatabaseResourceOwner;
}

function prismaClient(
  overrides: Partial<PrismaClientLifecycleMock> = {},
): Readonly<{ client: PrismaClient; lifecycle: PrismaClientLifecycleMock }> {
  const lifecycle: PrismaClientLifecycleMock = {
    $disconnect: jest.fn((): Promise<void> => Promise.resolve()),
    $queryRaw: jest.fn((): Promise<readonly unknown[]> => Promise.resolve([])),
    ...overrides,
  };

  return { client: lifecycle as unknown as PrismaClient, lifecycle };
}

function auxiliaryOwner(
  overrides: Partial<Pick<AuxiliaryOwnerHarness, 'beginClose' | 'close'>> = {},
): AuxiliaryOwnerHarness {
  const beginClose = overrides.beginClose ?? jest.fn((): void => undefined);
  const close = overrides.close ?? jest.fn((): Promise<void> => Promise.resolve());
  const owner: AuxiliaryDatabaseResourceOwner = {
    beginClose,
    close,
  };

  return { beginClose, close, owner };
}

describe('PrismaDatabaseDriver', (): void => {
  it('gates auxiliary acquisition synchronously before asynchronous shutdown', async (): Promise<void> => {
    const owner = auxiliaryOwner();
    const client = prismaClient();
    const driver = new PrismaDatabaseDriver(client.client, owner.owner);

    driver.beginClose();

    expect(owner.beginClose).toHaveBeenCalledTimes(1);
    expect(owner.close).toHaveBeenCalledTimes(1);
    expect(client.lifecycle.$disconnect).not.toHaveBeenCalled();
    await expect(driver.close()).resolves.toBeUndefined();
    expect(client.lifecycle.$disconnect).toHaveBeenCalledTimes(1);
    expect(owner.close).toHaveBeenCalledTimes(1);
  });

  it('attempts both resource closures and returns only a fixed cause-free failure', async (): Promise<void> => {
    const client = prismaClient({
      $disconnect: jest.fn((): Promise<void> =>
        Promise.reject(new Error('prisma provider detail')),
      ),
    });
    const owner = auxiliaryOwner({
      close: jest.fn((): Promise<void> => Promise.reject(new Error('mariadb provider detail'))),
    });
    const driver = new PrismaDatabaseDriver(client.client, owner.owner);

    let failure: unknown;

    try {
      await driver.close();
    } catch (error: unknown) {
      failure = error;
    }

    expect(client.lifecycle.$disconnect).toHaveBeenCalledTimes(1);
    expect(owner.close).toHaveBeenCalledTimes(1);
    expect(failure).toEqual(new Error('Database runtime shutdown failed'));
    expect(Object.hasOwn(failure as object, 'cause')).toBe(false);
    expect(String(failure)).not.toContain('provider detail');
  });

  it('continues to use Prisma alone for readiness probes', async (): Promise<void> => {
    const owner = auxiliaryOwner();
    const client = prismaClient();
    const driver = new PrismaDatabaseDriver(client.client, owner.owner);

    await expect(driver.probe()).resolves.toBeUndefined();

    expect(client.lifecycle.$queryRaw).toHaveBeenCalledTimes(1);
    expect(owner.beginClose).not.toHaveBeenCalled();
    expect(owner.close).not.toHaveBeenCalled();
  });
});
