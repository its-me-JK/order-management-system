import {
  InvalidConfigurationError,
  parseRedisRuntimeConfiguration,
  resolveRedisRuntimeConfiguration,
} from '../src';

describe('Redis runtime configuration', (): void => {
  it('applies local connection defaults', (): void => {
    expect(parseRedisRuntimeConfiguration({ REDIS_PASSWORD: 'secret' }, 'local')).toEqual({
      host: '127.0.0.1',
      port: 6379,
      username: 'oms_app',
      password: { kind: 'value', value: 'secret', variableName: 'REDIS_PASSWORD' },
      connectTimeoutMilliseconds: 500,
      commandTimeoutMilliseconds: 100,
      tls: { mode: 'disabled' },
    });
  });

  it.each(['showcase', 'staging', 'production'] as const)(
    'requires an explicit secure connection in %s',
    (deploymentEnvironment): void => {
      expect(() =>
        parseRedisRuntimeConfiguration({ REDIS_PASSWORD: 'secret' }, deploymentEnvironment),
      ).toThrow(new InvalidConfigurationError(['REDIS_HOST', 'REDIS_TLS_MODE', 'REDIS_USERNAME']));
    },
  );

  it('accepts a production TLS endpoint', (): void => {
    expect(
      parseRedisRuntimeConfiguration(
        {
          REDIS_HOST: 'redis.example.com',
          REDIS_PASSWORD: 'secret',
          REDIS_TLS_MODE: 'verify-identity',
          REDIS_USERNAME: 'orders_api',
        },
        'production',
      ),
    ).toEqual(
      expect.objectContaining({
        host: 'redis.example.com',
        username: 'orders_api',
        tls: { mode: 'verify-identity' },
      }),
    );
  });

  it('requires exactly one password source', (): void => {
    expect(() => parseRedisRuntimeConfiguration({}, 'local')).toThrow(
      new InvalidConfigurationError(['REDIS_PASSWORD', 'REDIS_PASSWORD_FILE']),
    );
    expect(() =>
      parseRedisRuntimeConfiguration(
        { REDIS_PASSWORD: 'one', REDIS_PASSWORD_FILE: 'two' },
        'local',
      ),
    ).toThrow(new InvalidConfigurationError(['REDIS_PASSWORD', 'REDIS_PASSWORD_FILE']));
  });

  it('rejects malformed hosts, ports, and timeouts', (): void => {
    for (const [name, value] of [
      ['REDIS_HOST', 'redis://cache.example'],
      ['REDIS_PORT', '0'],
      ['REDIS_CONNECT_TIMEOUT_MS', '99'],
      ['REDIS_COMMAND_TIMEOUT_MS', '501'],
    ] as const) {
      expect(() =>
        parseRedisRuntimeConfiguration({ REDIS_PASSWORD: 'secret', [name]: value }, 'local'),
      ).toThrow(new InvalidConfigurationError([name]));
    }
  });

  it('resolves a bounded file-backed password as canonical UTF-8', (): void => {
    const configuration = parseRedisRuntimeConfiguration(
      { REDIS_PASSWORD_FILE: '.secrets/redis' },
      'local',
    );

    expect(
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/workspace',
        readFile: (path, maximumBytes): Uint8Array => {
          expect(path).toBe('/workspace/.secrets/redis');
          expect(maximumBytes).toBeGreaterThan(8_192);
          return Buffer.from('file-secret\n');
        },
      }).password,
    ).toBe('file-secret');
  });

  it('rejects a relative secret base directory', (): void => {
    const configuration = parseRedisRuntimeConfiguration({ REDIS_PASSWORD: 'secret' }, 'local');

    expect(() =>
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '.',
        readFile: (): Uint8Array => Buffer.alloc(0),
      }),
    ).toThrow(TypeError);
  });
});
