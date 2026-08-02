import { rootCertificates } from 'node:tls';

import {
  InvalidConfigurationError,
  parseDatabaseRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
  type DatabaseRuntimeConfiguration,
} from '../src';

const trustedCertificate = rootCertificates[0];

if (trustedCertificate === undefined) {
  throw new Error('The Node.js runtime did not provide a root certificate');
}

function parseDevelopment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): DatabaseRuntimeConfiguration {
  return parseDatabaseRuntimeConfiguration(
    {
      DATABASE_PASSWORD: 'local-password',
      ...overrides,
    },
    'development',
  );
}

describe('parseDatabaseRuntimeConfiguration', (): void => {
  it('applies bounded local defaults without resolving the password', (): void => {
    expect(
      parseDatabaseRuntimeConfiguration(
        { DATABASE_PASSWORD_FILE: '.local/secrets/mysql-app-password' },
        'development',
      ),
    ).toEqual({
      host: '127.0.0.1',
      port: 3306,
      database: 'oms',
      user: 'oms_app',
      password: {
        kind: 'file',
        path: '.local/secrets/mysql-app-password',
        variableName: 'DATABASE_PASSWORD_FILE',
      },
      connectionLimit: 5,
      connectTimeoutMilliseconds: 5_000,
      acquireTimeoutMilliseconds: 10_000,
      probeTimeoutMilliseconds: 1_000,
      idleTimeoutSeconds: 300,
      tls: { mode: 'disabled' },
    });
  });

  it('requires explicit production identity and verified TLS', (): void => {
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

  it('parses a complete production configuration that uses system trust roots', (): void => {
    expect(
      parseDatabaseRuntimeConfiguration(
        {
          DATABASE_HOST: 'mysql.internal.example',
          DATABASE_NAME: 'orders',
          DATABASE_USER: 'orders_api',
          DATABASE_PASSWORD: '  byte-preserving password  ',
          DATABASE_TLS_MODE: 'verify-identity',
        },
        'production',
      ),
    ).toEqual(
      expect.objectContaining({
        host: 'mysql.internal.example',
        port: 3306,
        database: 'orders',
        user: 'orders_api',
        password: {
          kind: 'value',
          value: '  byte-preserving password  ',
          variableName: 'DATABASE_PASSWORD',
        },
        tls: { mode: 'verify-identity' },
      }),
    );
  });

  it.each([
    ['both absent', {}],
    [
      'both supplied',
      {
        DATABASE_PASSWORD: 'direct-secret',
        DATABASE_PASSWORD_FILE: '/run/secrets/database-password',
      },
    ],
  ])('rejects password sources when %s', (_description, passwordEnvironment): void => {
    expect(() => parseDatabaseRuntimeConfiguration(passwordEnvironment, 'development')).toThrow(
      new InvalidConfigurationError(['DATABASE_PASSWORD', 'DATABASE_PASSWORD_FILE']),
    );
  });

  it('rejects empty password sources without exposing their contents', (): void => {
    expect(() => parseDevelopment({ DATABASE_PASSWORD: '' })).toThrow(
      new InvalidConfigurationError(['DATABASE_PASSWORD']),
    );
  });

  it.each([
    ['DATABASE_HOST', 'db host'],
    ['DATABASE_HOST', 'mysql://db.example'],
    ['DATABASE_HOST', 'db.example/orders'],
    ['DATABASE_NAME', 'orders-prod'],
    ['DATABASE_USER', 'orders.api'],
    ['DATABASE_PORT', '0'],
    ['DATABASE_PORT', '65536'],
    ['DATABASE_PORT', ' 3306 '],
    ['DATABASE_CONNECTION_LIMIT', '51'],
    ['DATABASE_CONNECT_TIMEOUT_MS', '99'],
    ['DATABASE_ACQUIRE_TIMEOUT_MS', '60001'],
    ['DATABASE_PROBE_TIMEOUT_MS', '5001'],
    ['DATABASE_IDLE_TIMEOUT_SECONDS', '300.5'],
  ])('rejects an invalid %s value', (variableName, value): void => {
    expect(() => parseDevelopment({ [variableName]: value })).toThrow(
      new InvalidConfigurationError([variableName]),
    );
  });

  it('accepts every numeric boundary', (): void => {
    expect(
      parseDevelopment({
        DATABASE_PORT: '65535',
        DATABASE_CONNECTION_LIMIT: '50',
        DATABASE_CONNECT_TIMEOUT_MS: '100',
        DATABASE_ACQUIRE_TIMEOUT_MS: '60000',
        DATABASE_PROBE_TIMEOUT_MS: '5000',
        DATABASE_IDLE_TIMEOUT_SECONDS: '3600',
      }),
    ).toEqual(
      expect.objectContaining({
        port: 65_535,
        connectionLimit: 50,
        connectTimeoutMilliseconds: 100,
        acquireTimeoutMilliseconds: 60_000,
        probeTimeoutMilliseconds: 5_000,
        idleTimeoutSeconds: 3_600,
      }),
    );
  });

  it('rejects a connect timeout larger than the acquire timeout', (): void => {
    expect(() =>
      parseDevelopment({
        DATABASE_CONNECT_TIMEOUT_MS: '10001',
        DATABASE_ACQUIRE_TIMEOUT_MS: '10000',
      }),
    ).toThrow(
      new InvalidConfigurationError(['DATABASE_CONNECT_TIMEOUT_MS', 'DATABASE_ACQUIRE_TIMEOUT_MS']),
    );
  });

  it('rejects disabled TLS in production', (): void => {
    expect(() =>
      parseDatabaseRuntimeConfiguration(
        {
          DATABASE_HOST: 'db.example',
          DATABASE_NAME: 'orders',
          DATABASE_USER: 'orders_api',
          DATABASE_PASSWORD: 'secret',
          DATABASE_TLS_MODE: 'disabled',
        },
        'production',
      ),
    ).toThrow(new InvalidConfigurationError(['DATABASE_TLS_MODE']));
  });

  it('allows at most one certificate authority source', (): void => {
    expect(() =>
      parseDevelopment({
        DATABASE_TLS_MODE: 'verify-identity',
        DATABASE_TLS_CA: trustedCertificate,
        DATABASE_TLS_CA_FILE: '/run/secrets/database-ca',
      }),
    ).toThrow(new InvalidConfigurationError(['DATABASE_TLS_CA', 'DATABASE_TLS_CA_FILE']));
  });

  it('rejects a certificate authority when TLS is disabled', (): void => {
    expect(() => parseDevelopment({ DATABASE_TLS_CA: trustedCertificate })).toThrow(
      new InvalidConfigurationError(['DATABASE_TLS_CA', 'DATABASE_TLS_MODE']),
    );
  });

  it('returns deeply frozen source references and TLS configuration', (): void => {
    const configuration = parseDevelopment({
      DATABASE_TLS_MODE: 'verify-identity',
      DATABASE_TLS_CA_FILE: 'certificates/database-ca.pem',
    });

    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.password)).toBe(true);
    expect(Object.isFrozen(configuration.tls)).toBe(true);

    if (configuration.tls.mode === 'verify-identity') {
      expect(Object.isFrozen(configuration.tls.certificateAuthority)).toBe(true);
    }
  });

  it('ignores migration, shadow, and Docker-only credentials', (): void => {
    const configuration = parseDevelopment({
      DATABASE_MIGRATION_URL: 'mysql://ddl:secret@db/migrations',
      DATABASE_SHADOW_URL: 'mysql://ddl:secret@db/shadow',
      MYSQL_ROOT_PASSWORD_FILE: '/run/secrets/mysql-root-password',
    });

    expect(configuration.password).toEqual({
      kind: 'value',
      value: 'local-password',
      variableName: 'DATABASE_PASSWORD',
    });
  });

  it('aggregates names while keeping invalid values out of the error', (): void => {
    const secretPassword = 'password-that-must-not-leak';
    const invalidHost = 'https://host-that-must-not-leak';

    expect.assertions(4);

    try {
      parseDevelopment({
        DATABASE_HOST: invalidHost,
        DATABASE_PASSWORD: secretPassword,
        DATABASE_PASSWORD_FILE: '/secret/path-that-must-not-leak',
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(String(error)).toContain('DATABASE_HOST, DATABASE_PASSWORD, DATABASE_PASSWORD_FILE');
      expect(String(error)).not.toContain(secretPassword);
      expect(String(error)).not.toContain(invalidHost);
    }
  });
});

describe('resolveDatabaseRuntimeConfiguration', (): void => {
  it('preserves inline secrets and maps verified TLS to driver-ready values', (): void => {
    const readFile = jest.fn((): string => 'unused');
    const configuration = parseDevelopment({
      DATABASE_PASSWORD: ' password bytes ',
      DATABASE_TLS_MODE: 'verify-identity',
      DATABASE_TLS_CA: trustedCertificate,
    });

    const resolved = resolveDatabaseRuntimeConfiguration(configuration, {
      baseDirectory: '/srv/oms',
      readFile,
    });

    expect(resolved).toEqual({
      host: '127.0.0.1',
      port: 3306,
      database: 'oms',
      user: 'oms_app',
      password: ' password bytes ',
      connectionLimit: 5,
      connectTimeoutMilliseconds: 5_000,
      acquireTimeoutMilliseconds: 10_000,
      probeTimeoutMilliseconds: 1_000,
      idleTimeoutSeconds: 300,
      tls: {
        enabled: true,
        certificateAuthority: trustedCertificate,
      },
    });
    expect(readFile).not.toHaveBeenCalled();
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.tls)).toBe(true);
  });

  it('resolves relative file references against the explicit base and removes one newline', (): void => {
    const readFile = jest.fn((path: string): string => {
      const files: Readonly<Record<string, string>> = {
        '/srv/oms/secrets/database-password': 'password\n\n',
        '/srv/oms/certificates/database-ca.pem': `${trustedCertificate}\r\n`,
      };

      const value = files[path];

      if (value === undefined) {
        throw new Error('unexpected path');
      }

      return value;
    });
    const configuration = parseDatabaseRuntimeConfiguration(
      {
        DATABASE_PASSWORD_FILE: 'secrets/database-password',
        DATABASE_TLS_MODE: 'verify-identity',
        DATABASE_TLS_CA_FILE: 'certificates/database-ca.pem',
      },
      'development',
    );

    const resolved = resolveDatabaseRuntimeConfiguration(configuration, {
      baseDirectory: '/srv/oms',
      readFile,
    });

    expect(resolved.password).toBe('password\n');
    expect(resolved.tls).toEqual({
      enabled: true,
      certificateAuthority: trustedCertificate,
    });
    expect(readFile).toHaveBeenNthCalledWith(1, '/srv/oms/secrets/database-password');
    expect(readFile).toHaveBeenNthCalledWith(2, '/srv/oms/certificates/database-ca.pem');
  });

  it('aggregates unreadable secret sources without exposing paths or causes', (): void => {
    const passwordPath = 'private/password-do-not-log';
    const certificatePath = 'private/ca-do-not-log.pem';
    const configuration = parseDatabaseRuntimeConfiguration(
      {
        DATABASE_PASSWORD_FILE: passwordPath,
        DATABASE_TLS_MODE: 'verify-identity',
        DATABASE_TLS_CA_FILE: certificatePath,
      },
      'development',
    );

    expect.assertions(5);

    try {
      resolveDatabaseRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): string => {
          throw new Error('sensitive operating-system error');
        },
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error).toHaveProperty(
        'message',
        'Invalid runtime configuration: DATABASE_PASSWORD_FILE, DATABASE_TLS_CA_FILE',
      );
      expect(String(error)).not.toContain(passwordPath);
      expect(String(error)).not.toContain(certificatePath);
      expect(String(error)).not.toContain('sensitive operating-system error');
    }
  });

  it.each([[''], ['\n'], ['\r\n']])(
    'rejects a password file empty after removing one terminal newline',
    (contents): void => {
      const configuration = parseDatabaseRuntimeConfiguration(
        { DATABASE_PASSWORD_FILE: 'secrets/password' },
        'test',
      );

      expect(() =>
        resolveDatabaseRuntimeConfiguration(configuration, {
          baseDirectory: '/srv/oms',
          readFile: (): string => contents,
        }),
      ).toThrow(new InvalidConfigurationError(['DATABASE_PASSWORD_FILE']));
    },
  );

  it('rejects a malformed certificate authority without exposing its contents', (): void => {
    const malformedCertificate = 'not-a-pem-certificate-that-must-not-leak';
    const configuration = parseDevelopment({
      DATABASE_TLS_MODE: 'verify-identity',
      DATABASE_TLS_CA: malformedCertificate,
    });

    expect.assertions(2);

    try {
      resolveDatabaseRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): string => '',
      });
    } catch (error: unknown) {
      expect(error).toEqual(new InvalidConfigurationError(['DATABASE_TLS_CA']));
      expect(String(error)).not.toContain(malformedCertificate);
    }
  });

  it('requires an absolute secret base directory', (): void => {
    expect(() =>
      resolveDatabaseRuntimeConfiguration(parseDevelopment(), {
        baseDirectory: 'relative/path',
        readFile: (): string => '',
      }),
    ).toThrow(new TypeError('Database secret base directory must be absolute'));
  });
});
