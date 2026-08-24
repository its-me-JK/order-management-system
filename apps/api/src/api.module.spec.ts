import { Test } from '@nestjs/testing';

import type { DatabaseRuntime } from '@oms/database';

import { ApiModule } from './api.module';
import { DATABASE_CONNECTION } from './platform/database/database.tokens';
import { REDIS_RUNTIME } from './platform/redis/redis.tokens';
import { createDatabaseRuntimeFixture } from '../test-support/database-runtime.fixture';
import { createRedisRuntimeFixture } from '../test-support/redis-runtime.fixture';

describe('ApiModule', (): void => {
  it('owns and closes one database and Redis runtime', async (): Promise<void> => {
    const close = jest.fn((): Promise<void> => Promise.resolve());
    const closeRedis = jest.fn((): Promise<void> => Promise.resolve());
    const probe = jest.fn((): Promise<void> => Promise.resolve());
    const runtime = createDatabaseRuntimeFixture({ close, probe });
    const redisRuntime = createRedisRuntimeFixture({ close: closeRedis });
    const createDatabaseRuntime = jest.fn((): DatabaseRuntime => runtime);
    const createRedisRuntime = jest.fn(() => redisRuntime);
    const moduleReference = await Test.createTestingModule({
      imports: [
        ApiModule.register({
          createDatabaseRuntime,
          createRedisRuntime,
          observability: {
            deploymentEnvironment: 'test',
            level: 'silent',
          },
        }),
      ],
    }).compile();

    try {
      expect(createDatabaseRuntime).toHaveBeenCalledTimes(1);
      expect(createRedisRuntime).toHaveBeenCalledTimes(1);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(runtime.connection);
      expect(moduleReference.get(DATABASE_CONNECTION)).toBe(runtime.connection);
      expect(moduleReference.get(REDIS_RUNTIME)).toBe(redisRuntime);
      expect(probe).not.toHaveBeenCalled();
    } finally {
      await moduleReference.close();
    }

    expect(close).toHaveBeenCalledTimes(1);
    expect(closeRedis).toHaveBeenCalledTimes(1);
  });
});
