import { isIP } from 'node:net';

import { createClient } from '@redis/client';

import {
  RedisRuntimeUnavailableError,
  type RedisRuntime,
  type RedisRuntimeOptions,
} from './redis.contract';

const RATE_LIMIT_SCRIPT = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return value
`;

function assertKey(key: string): void {
  if (!/^oms:[a-z0-9][a-z0-9:._-]{0,199}$/u.test(key)) {
    throw new TypeError('Redis key must use the oms namespace');
  }
}

function assertTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
    throw new TypeError('Redis TTL is outside the supported range');
  }
}

function createNodeClient(options: RedisRuntimeOptions) {
  const socket = options.tls.enabled
    ? {
        ca: options.tls.certificateAuthority,
        connectTimeout: options.connectTimeoutMilliseconds,
        host: options.host,
        port: options.port,
        reconnectStrategy: false as const,
        rejectUnauthorized: true,
        ...(isIP(options.host) === 0 ? { servername: options.host } : {}),
        tls: true as const,
      }
    : {
        connectTimeout: options.connectTimeoutMilliseconds,
        host: options.host,
        port: options.port,
        reconnectStrategy: false as const,
        tls: false as const,
      };

  return createClient({
    RESP: 2,
    disableOfflineQueue: true,
    password: options.password,
    socket,
    username: options.username,
  });
}

export function createRedisRuntime(options: RedisRuntimeOptions): RedisRuntime {
  const client = createNodeClient(options);
  let connectOperation: Promise<void> | undefined;
  let closed = false;

  client.on('error', (): void => undefined);

  const connect = async (): Promise<void> => {
    if (closed) {
      throw new RedisRuntimeUnavailableError();
    }

    if (client.isReady) {
      return;
    }

    connectOperation ??= client.connect().then((): void => undefined);

    try {
      await connectOperation;
    } catch {
      if (client.isOpen) {
        client.destroy();
      }
      throw new RedisRuntimeUnavailableError();
    } finally {
      connectOperation = undefined;
    }
  };

  const execute = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    await connect();

    try {
      return await operation();
    } catch {
      if (client.isOpen) {
        client.destroy();
      }

      throw new RedisRuntimeUnavailableError();
    }
  };

  return Object.freeze({
    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      if (client.isOpen) {
        try {
          await client.quit();
        } catch {
          client.destroy();
        }
      }
    },
    async delete(key: string): Promise<void> {
      assertKey(key);
      await execute(() => client.del(key).then((): void => undefined));
    },
    async get(key: string): Promise<string | null> {
      assertKey(key);
      return execute(() =>
        client.withAbortSignal(AbortSignal.timeout(options.commandTimeoutMilliseconds)).get(key),
      );
    },
    incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
      assertKey(key);
      assertTtl(ttlSeconds);
      return execute(async (): Promise<number> => {
        const result = await client
          .withAbortSignal(AbortSignal.timeout(options.commandTimeoutMilliseconds))
          .eval(RATE_LIMIT_SCRIPT, { arguments: [String(ttlSeconds)], keys: [key] });

        if (typeof result !== 'number') {
          throw new RedisRuntimeUnavailableError();
        }

        return result;
      });
    },
    async probe(): Promise<void> {
      const result = await execute(() =>
        client.withAbortSignal(AbortSignal.timeout(options.commandTimeoutMilliseconds)).ping(),
      );

      if (result !== 'PONG') {
        throw new RedisRuntimeUnavailableError();
      }
    },
    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      assertKey(key);
      assertTtl(ttlSeconds);
      await execute(() =>
        client
          .withAbortSignal(AbortSignal.timeout(options.commandTimeoutMilliseconds))
          .set(key, value, { EX: ttlSeconds })
          .then((): void => undefined),
      );
    },
  });
}
