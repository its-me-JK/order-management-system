import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  // @ts-expect-error Lua execution remains on the infrastructure-only subpath.
  RedisLuaScript as LeakedRedisLuaScript,
  // @ts-expect-error The vendor client is never exported by the runtime root.
  RedisClientType as LeakedRedisClientType,
} from '../src';
import * as redisRootSurface from '../src';
import * as redisLuaScriptSurface from '../src/lua-script';

const rootValueExports = ['RedisRuntimeUnavailableError', 'createRedisRuntime'] as const;
const luaValueExports = [
  'InvalidRedisLuaScriptError',
  'createRedisLuaScriptExecutor',
  'defineRedisLuaScript',
] as const;

describe('@oms/redis public surfaces', (): void => {
  it('publishes only the lifecycle root and Lua-script infrastructure subpath', (): void => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as Readonly<{
      dependencies?: Readonly<Record<string, string>>;
      exports?: Readonly<Record<string, unknown>>;
    }>;

    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual(['.', './lua-script']);
    expect(manifest.exports?.['.']).toEqual({
      default: './dist/index.js',
      types: './src/index.ts',
    });
    expect(manifest.exports?.['./lua-script']).toEqual({
      default: './dist/lua-script.js',
      types: './src/lua-script.ts',
    });
    expect(manifest.dependencies).toEqual({ '@redis/client': '6.2.1' });
  });

  it('exports exactly the supported runtime values from the root', (): void => {
    expect(Object.keys(redisRootSurface).sort()).toEqual([...rootValueExports].sort());
  });

  it('exports exactly the supported Lua-script values from its subpath', (): void => {
    expect(Object.keys(redisLuaScriptSurface).sort()).toEqual([...luaValueExports].sort());
  });

  it('keeps vendor and internal runtime capabilities out of both barrels', (): void => {
    const rootSource = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
    const luaSource = readFileSync(resolve(__dirname, '../src/lua-script.ts'), 'utf8');

    for (const source of [rootSource, luaSource]) {
      expect(source).not.toContain('@redis/client');
      expect(source).not.toContain('ManagedRedisClient');
      expect(source).not.toContain('RedisClientFactory');
      expect(source).not.toContain('getRedisRuntimeState');
      expect(source).not.toContain('getRedisLuaScriptRegistration');
      expect(source).not.toContain('sendCommand');
      expect(source).not.toContain('source extractor');
      expect(source).not.toContain('ErrorReply');
    }
  });

  it('has no client, endpoint, state, script-source, or generic-command subpath', (): void => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as Readonly<{ exports?: Readonly<Record<string, unknown>> }>;
    const exports = manifest.exports ?? {};

    for (const forbiddenSubpath of [
      './client',
      './connection',
      './state',
      './script-source',
      './commands',
    ]) {
      expect(exports).not.toHaveProperty(forbiddenSubpath);
    }
  });
});

void (undefined as unknown as LeakedRedisLuaScript);
void (undefined as unknown as LeakedRedisClientType);
