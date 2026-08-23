export type RedisTlsOptions =
  | Readonly<{
      enabled: false;
    }>
  | Readonly<{
      certificateAuthority?: string;
      enabled: true;
    }>;

export interface RedisConnectionOptions {
  readonly commandQueueLimit: number;
  readonly commandTimeoutMilliseconds: number;
  readonly connectTimeoutMilliseconds: number;
  readonly host: string;
  readonly password: string;
  readonly port: number;
  readonly probeTimeoutMilliseconds: number;
  readonly shutdownTimeoutMilliseconds: number;
  readonly tls: RedisTlsOptions;
  readonly username: string;
}

export interface RedisConnection {
  probe(): Promise<void>;
}

/** Owns one process-local Redis client without exposing its vendor API or state. */
export interface RedisRuntime {
  readonly connection: RedisConnection;
  close(): Promise<void>;
}

export class RedisRuntimeUnavailableError extends Error {
  public constructor() {
    super('Redis runtime is unavailable');
    this.name = 'RedisRuntimeUnavailableError';
  }
}
