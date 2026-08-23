import type { DatabaseDriver } from './database.driver';

import type { PrismaClient } from '../generated/prisma/client';

export interface AuxiliaryDatabaseResourceOwner {
  beginClose(): void;
  close(): Promise<void>;
}

export class PrismaDatabaseDriver implements DatabaseDriver {
  private auxiliaryCloseOperation: Promise<void> | undefined;

  public constructor(
    private readonly client: PrismaClient,
    private readonly auxiliaryResourceOwner?: AuxiliaryDatabaseResourceOwner,
  ) {}

  public beginClose(): void {
    if (this.auxiliaryResourceOwner === undefined) {
      return;
    }

    this.auxiliaryResourceOwner.beginClose();
    this.auxiliaryCloseOperation ??= this.auxiliaryResourceOwner.close();
    void this.auxiliaryCloseOperation.catch((): void => undefined);
  }

  public async probe(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  public async close(): Promise<void> {
    const operations = [
      Promise.resolve().then(async (): Promise<void> => this.client.$disconnect()),
      this.auxiliaryResourceOwner === undefined
        ? Promise.resolve()
        : (this.auxiliaryCloseOperation ?? this.auxiliaryResourceOwner.close()),
    ];
    const outcomes = await Promise.allSettled(operations);

    if (outcomes.some((outcome): boolean => outcome.status === 'rejected')) {
      throw new Error('Database runtime shutdown failed');
    }
  }
}
