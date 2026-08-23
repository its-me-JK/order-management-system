import { createNodeRedisClient } from './client/node-redis-client.factory';
import type { RedisConnectionOptions, RedisRuntime } from './redis.contract';
import { createRedisRuntimeWithClientFactory } from './redis-runtime';

export function createRedisRuntime(options: RedisConnectionOptions): RedisRuntime {
  return createRedisRuntimeWithClientFactory(options, createNodeRedisClient);
}
