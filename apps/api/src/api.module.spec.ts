import { Test } from '@nestjs/testing';

import type { DatabaseRuntime } from '@oms/database';

import { ApiModule } from './api.module';
import { createDatabaseRuntimeFixture } from './platform/database/database-runtime.fixture';
import { DATABASE_CONNECTION } from './platform/database/database.tokens';

describe('ApiModule', (): void => {
  it('owns one application-scoped database runtime and closes it on shutdown', async (): Promise<void> => {
    const close = jest.fn((): Promise<void> => Promise.resolve());
    const probe = jest.fn((): Promise<void> => Promise.resolve());
    const runtime = createDatabaseRuntimeFixture({ close, probe });
    const createDatabaseRuntime = jest.fn((): DatabaseRuntime => runtime);
    const moduleReference = await Test.createTestingModule({
      imports: [
        ApiModule.register({
          createDatabaseRuntime,
          observability: {
            deploymentEnvironment: 'test',
            level: 'silent',
          },
        }),
      ],
    }).compile();

    try {
      expect(createDatabaseRuntime).toHaveBeenCalledTimes(1);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(runtime.connection);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(runtime.connection);
      expect(probe).not.toHaveBeenCalled();
    } finally {
      await moduleReference.close();
    }

    expect(close).toHaveBeenCalledTimes(1);
  });
});
