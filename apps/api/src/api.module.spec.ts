import { Test } from '@nestjs/testing';

import type { DatabaseConnection } from '@oms/database';

import { ApiModule } from './api.module';
import { DATABASE_CONNECTION } from './platform/database/database.tokens';

describe('ApiModule', (): void => {
  it('owns one application-scoped database connection and closes it on shutdown', async (): Promise<void> => {
    const close = jest.fn((): Promise<void> => Promise.resolve());
    const probe = jest.fn((): Promise<void> => Promise.resolve());
    const database: DatabaseConnection = {
      close,
      probe,
    };
    const createDatabaseConnection = jest.fn((): DatabaseConnection => database);
    const moduleReference = await Test.createTestingModule({
      imports: [ApiModule.register({ createDatabaseConnection })],
    }).compile();

    try {
      expect(createDatabaseConnection).toHaveBeenCalledTimes(1);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(database);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(database);
      expect(probe).not.toHaveBeenCalled();
    } finally {
      await moduleReference.close();
    }

    expect(close).toHaveBeenCalledTimes(1);
  });
});
