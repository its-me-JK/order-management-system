import type { RedisRuntime } from '@oms/redis';

export interface RedisRuntimeFixtureOptions {
  readonly close?: () => Promise<void>;
  readonly probe?: () => Promise<void>;
}

/** In-memory Redis substitute shared by API unit and integration tests. */
export function createRedisRuntimeFixture(options: RedisRuntimeFixtureOptions = {}): RedisRuntime {
  const values = new Map<string, string>();
  const counters = new Map<string, number>();
  let closed = false;

  const requireOpen = (): void => {
    if (closed) {
      throw new Error('Redis fixture is closed');
    }
  };

  return {
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await options.close?.();
    },
    delete(key: string): Promise<void> {
      requireOpen();
      values.delete(key);
      counters.delete(key);
      return Promise.resolve();
    },
    get(key: string): Promise<string | null> {
      requireOpen();
      return Promise.resolve(values.get(key) ?? null);
    },
    incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
      requireOpen();
      void ttlSeconds;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve(next);
    },
    async probe(): Promise<void> {
      requireOpen();
      await options.probe?.();
    },
    set(key: string, value: string, ttlSeconds: number): Promise<void> {
      requireOpen();
      void ttlSeconds;
      values.set(key, value);
      return Promise.resolve();
    },
  };
}
