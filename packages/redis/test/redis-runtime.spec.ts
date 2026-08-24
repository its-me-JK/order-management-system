import { createRedisRuntime, RedisRuntimeUnavailableError } from '../src';

describe('Redis runtime input contract', (): void => {
  const runtime = createRedisRuntime({
    commandTimeoutMilliseconds: 100,
    connectTimeoutMilliseconds: 100,
    host: '127.0.0.1',
    password: 'not-used',
    port: 1,
    tls: { enabled: false },
    username: 'oms_app',
  });

  afterAll(async (): Promise<void> => runtime.close());

  it('rejects keys outside the application namespace without connecting', async (): Promise<void> => {
    await expect(runtime.get('other:key')).rejects.toThrow(TypeError);
  });

  it('translates connection failures to the public unavailable error', async (): Promise<void> => {
    await expect(runtime.probe()).rejects.toThrow(RedisRuntimeUnavailableError);
  });
});
