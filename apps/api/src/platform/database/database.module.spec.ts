import { Test } from '@nestjs/testing';

import type { DatabaseRuntime } from '@oms/database';
import { createPrismaDatabaseRuntime, type PrismaClient } from '@oms/database/prisma';

import { DatabaseModule } from './database.module';
import { DATABASE_CLIENT, DATABASE_CONNECTION } from './database.tokens';

describe('DatabaseModule', (): void => {
  it('projects one client-backed runtime and disconnects it exactly once', async (): Promise<void> => {
    const disconnect = jest.fn((): Promise<void> => Promise.resolve());
    const queryRaw = jest.fn((): Promise<void> => Promise.resolve());
    const client = {
      $disconnect: disconnect,
      $queryRaw: queryRaw,
    } as unknown as PrismaClient;
    const runtime = createPrismaDatabaseRuntime(client);
    const createRuntime = jest.fn((): DatabaseRuntime => runtime);
    const moduleReference = await Test.createTestingModule({
      imports: [DatabaseModule.register(createRuntime)],
    }).compile();

    try {
      expect(createRuntime).toHaveBeenCalledTimes(1);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(runtime.connection);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(runtime.connection);
      expect(moduleReference.get(DATABASE_CLIENT)).toBe(client);
      expect(moduleReference.get(DATABASE_CLIENT)).toBe(client);
      expect(queryRaw).not.toHaveBeenCalled();

      await runtime.connection.close();
    } finally {
      await moduleReference.close();
    }

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
