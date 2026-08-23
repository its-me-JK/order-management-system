declare const redisLuaScriptBrand: unique symbol;

export type RedisLuaScript = RedisLuaScriptValue &
  Readonly<{
    [redisLuaScriptBrand]: true;
  }>;

export interface RedisLuaScriptExecutor {
  execute(
    script: RedisLuaScript,
    keys: readonly string[],
    arguments_: readonly string[],
  ): Promise<unknown>;
}

export class InvalidRedisLuaScriptError extends Error {
  public constructor() {
    super('Invalid Redis Lua script value');
    this.name = 'InvalidRedisLuaScriptError';
  }
}

/** @internal Runtime class is declared here so the nominal type has no exported data fields. */
export abstract class RedisLuaScriptValue {
  public abstract toJSON(): string;
  public abstract toString(): string;
  public abstract [Symbol.toPrimitive](): string;
}
