import type { DatabaseDriver } from './database.driver';

import type { PrismaClient } from '../generated/prisma/client';

export class PrismaDatabaseDriver implements DatabaseDriver {
  public constructor(private readonly client: PrismaClient) {}

  public async probe(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  public async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
