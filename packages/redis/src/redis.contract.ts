export type RedisTlsOptions =
  Readonly<{ enabled: false }> | Readonly<{ certificateAuthority?: string; enabled: true }>;

export interface RedisRuntimeOptions {
  readonly commandTimeoutMilliseconds: number;
  readonly connectTimeoutMilliseconds: number;
  readonly host: string;
  readonly password: string;
  readonly port: number;
  readonly tls: RedisTlsOptions;
  readonly username: string;
}

export interface RedisRuntime {
  close(): Promise<void>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
  probe(): Promise<void>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export class RedisRuntimeUnavailableError extends Error {
  public constructor() {
    super('Redis runtime is unavailable');
    this.name = 'RedisRuntimeUnavailableError';
  }
}
