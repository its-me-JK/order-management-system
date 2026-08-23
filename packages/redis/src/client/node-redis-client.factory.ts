import {
  createClient,
  type RedisClientOptions as NodeRedisClientOptions,
  type RedisClientType,
} from '@redis/client';
import { isIP } from 'node:net';

import type { RedisConnectionOptions } from '../redis.contract';
import type { ManagedRedisClient } from './redis-client';

type NodeRedisClient = RedisClientType<
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  2
>;

export function toNodeRedisClientOptions(
  options: RedisConnectionOptions,
): NodeRedisClientOptions<never, never, never, 2> {
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

  return {
    RESP: 2,
    commandsQueueMaxLength: options.commandQueueLimit,
    disableClientInfo: true,
    disableOfflineQueue: true,
    password: options.password,
    socket,
    username: options.username,
  };
}

class NodeRedisClientAdapter implements ManagedRedisClient {
  public constructor(private readonly client: NodeRedisClient) {}

  public get isOpen(): boolean {
    return this.client.isOpen;
  }

  public get isReady(): boolean {
    return this.client.isReady;
  }

  public connect(): Promise<void> {
    return this.client.connect().then((): void => undefined);
  }

  public destroy(): void {
    this.client.destroy();
  }

  public evaluate(
    source: string,
    keys: readonly string[],
    arguments_: readonly string[],
    abortSignal: AbortSignal,
  ): Promise<unknown> {
    return this.client.withAbortSignal(abortSignal).eval(source, {
      arguments: [...arguments_],
      keys: [...keys],
    });
  }

  public evaluateSha(
    digest: string,
    keys: readonly string[],
    arguments_: readonly string[],
    abortSignal: AbortSignal,
  ): Promise<unknown> {
    return this.client.withAbortSignal(abortSignal).evalSha(digest, {
      arguments: [...arguments_],
      keys: [...keys],
    });
  }

  public onError(listener: (error: unknown) => void): void {
    this.client.on('error', listener);
  }

  public ping(abortSignal: AbortSignal): Promise<unknown> {
    return this.client.withAbortSignal(abortSignal).ping();
  }
}

export function createNodeRedisClient(options: RedisConnectionOptions): ManagedRedisClient {
  const client = createClient(toNodeRedisClientOptions(options)) as NodeRedisClient;

  return new NodeRedisClientAdapter(client);
}
