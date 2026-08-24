import {
  InvalidConfigurationError,
  parseDatabaseRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
} from '../src';

describe('database runtime configuration', (): void => {
  it('applies bounded local defaults', (): void => {
    expect(
      parseDatabaseRuntimeConfiguration({ DATABASE_PASSWORD: 'local-password' }, 'development'),
    ).toEqual({
      host: '127.0.0.1',
      port: 3306,
      database: 'oms',
      user: 'oms_app',
      password: {
        kind: 'value',
        value: 'local-password',
        variableName: 'DATABASE_PASSWORD',
      },
      connectionLimit: 5,
      connectTimeoutMilliseconds: 5_000,
      acquireTimeoutMilliseconds: 10_000,
      probeTimeoutMilliseconds: 1_000,
      idleTimeoutSeconds: 300,
      tls: { mode: 'disabled' },
    });
  });

  it('requires an explicit production connection and verified TLS', (): void => {
    expect(() =>
      parseDatabaseRuntimeConfiguration({ DATABASE_PASSWORD: 'secret' }, 'production'),
    ).toThrow(
      new InvalidConfigurationError([
        'DATABASE_HOST',
        'DATABASE_NAME',
        'DATABASE_TLS_MODE',
        'DATABASE_USER',
      ]),
    );
  });

  it('accepts a complete production connection', (): void => {
    const configuration = parseDatabaseRuntimeConfiguration(
      {
        DATABASE_HOST: 'mysql.example.com',
        DATABASE_NAME: 'orders',
        DATABASE_PASSWORD: 'secret',
        DATABASE_TLS_MODE: 'verify-identity',
        DATABASE_USER: 'orders_api',
      },
      'production',
    );

    expect(configuration).toEqual(
      expect.objectContaining({
        host: 'mysql.example.com',
        database: 'orders',
        user: 'orders_api',
        tls: { mode: 'verify-identity' },
      }),
    );
  });

  it('requires exactly one password source', (): void => {
    expect(() => parseDatabaseRuntimeConfiguration({}, 'development')).toThrow(
      new InvalidConfigurationError(['DATABASE_PASSWORD', 'DATABASE_PASSWORD_FILE']),
    );
    expect(() =>
      parseDatabaseRuntimeConfiguration(
        { DATABASE_PASSWORD: 'one', DATABASE_PASSWORD_FILE: 'two' },
        'development',
      ),
    ).toThrow(new InvalidConfigurationError(['DATABASE_PASSWORD', 'DATABASE_PASSWORD_FILE']));
  });

  it('rejects invalid limits and timeout ordering', (): void => {
    expect(() =>
      parseDatabaseRuntimeConfiguration(
        { DATABASE_CONNECTION_LIMIT: '0', DATABASE_PASSWORD: 'secret' },
        'development',
      ),
    ).toThrow(new InvalidConfigurationError(['DATABASE_CONNECTION_LIMIT']));
    expect(() =>
      parseDatabaseRuntimeConfiguration(
        {
          DATABASE_ACQUIRE_TIMEOUT_MS: '100',
          DATABASE_CONNECT_TIMEOUT_MS: '101',
          DATABASE_PASSWORD: 'secret',
        },
        'development',
      ),
    ).toThrow(
      new InvalidConfigurationError(['DATABASE_ACQUIRE_TIMEOUT_MS', 'DATABASE_CONNECT_TIMEOUT_MS']),
    );
  });

  it('resolves a file-backed password without retaining its terminal newline', (): void => {
    const configuration = parseDatabaseRuntimeConfiguration(
      { DATABASE_PASSWORD_FILE: '.secrets/database' },
      'development',
    );

    expect(
      resolveDatabaseRuntimeConfiguration(configuration, {
        baseDirectory: '/workspace',
        readFile: (path): string => {
          expect(path).toBe('/workspace/.secrets/database');
          return 'file-secret\n';
        },
      }).password,
    ).toBe('file-secret');
  });
});
