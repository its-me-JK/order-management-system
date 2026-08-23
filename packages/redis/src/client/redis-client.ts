export interface ManagedRedisClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<void>;
  destroy(): void;
  evaluate(
    source: string,
    keys: readonly string[],
    arguments_: readonly string[],
    abortSignal: AbortSignal,
  ): Promise<unknown>;
  evaluateSha(
    digest: string,
    keys: readonly string[],
    arguments_: readonly string[],
    abortSignal: AbortSignal,
  ): Promise<unknown>;
  onError(listener: (error: unknown) => void): void;
  ping(abortSignal: AbortSignal): Promise<unknown>;
}

export type RedisClientFactory = (options: RedisConnectionOptions) => ManagedRedisClient;
import type { RedisConnectionOptions } from '../redis.contract';
