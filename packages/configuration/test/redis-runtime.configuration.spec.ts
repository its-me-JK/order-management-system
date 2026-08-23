import { rootCertificates } from 'node:tls';

import {
  InvalidConfigurationError,
  parseRedisRuntimeConfiguration,
  resolveRedisRuntimeConfiguration,
  type RedisRuntimeConfiguration,
} from '../src';

const trustedCertificate = rootCertificates[0];

if (trustedCertificate === undefined) {
  throw new Error('The Node.js runtime did not provide a root certificate');
}

function parseLocal(
  overrides: Readonly<Record<string, string | undefined>> = {},
): RedisRuntimeConfiguration {
  return parseRedisRuntimeConfiguration(
    {
      REDIS_PASSWORD: 'local-password',
      ...overrides,
    },
    'local',
  );
}

describe('parseRedisRuntimeConfiguration', (): void => {
  it('applies bounded local defaults without resolving the password', (): void => {
    expect(
      parseRedisRuntimeConfiguration(
        { REDIS_PASSWORD_FILE: '.local/secrets/redis-app-password' },
        'local',
      ),
    ).toEqual({
      host: '127.0.0.1',
      port: 6379,
      username: 'oms_app',
      password: {
        kind: 'file',
        path: '.local/secrets/redis-app-password',
        variableName: 'REDIS_PASSWORD_FILE',
      },
      connectTimeoutMilliseconds: 500,
      commandTimeoutMilliseconds: 100,
      probeTimeoutMilliseconds: 500,
      shutdownTimeoutMilliseconds: 1_000,
      commandQueueLimit: 256,
      tls: { mode: 'disabled' },
    });
  });

  it.each(['showcase', 'staging', 'production'] as const)(
    'requires an explicit host, ACL username, and verified TLS in %s',
    (deploymentEnvironment): void => {
      expect(() =>
        parseRedisRuntimeConfiguration({ REDIS_PASSWORD: 'secret' }, deploymentEnvironment),
      ).toThrow(new InvalidConfigurationError(['REDIS_HOST', 'REDIS_TLS_MODE', 'REDIS_USERNAME']));
    },
  );

  it('parses production configuration with an explicit ACL username', (): void => {
    const configuration = parseRedisRuntimeConfiguration(
      {
        REDIS_HOST: 'redis.internal.example',
        REDIS_USERNAME: 'orders_api',
        REDIS_PASSWORD: '  byte-preserving password  ',
        REDIS_TLS_MODE: 'verify-identity',
      },
      'production',
    );

    expect(configuration).toEqual({
      host: 'redis.internal.example',
      port: 6379,
      username: 'orders_api',
      password: {
        kind: 'value',
        value: '  byte-preserving password  ',
        variableName: 'REDIS_PASSWORD',
      },
      connectTimeoutMilliseconds: 500,
      commandTimeoutMilliseconds: 100,
      probeTimeoutMilliseconds: 500,
      shutdownTimeoutMilliseconds: 1_000,
      commandQueueLimit: 256,
      tls: { mode: 'verify-identity' },
    });
  });

  it.each([
    ['both absent', {}],
    [
      'both supplied',
      {
        REDIS_PASSWORD: 'direct-secret',
        REDIS_PASSWORD_FILE: '/run/secrets/redis-password',
      },
    ],
  ])('rejects password sources when %s', (_description, passwordEnvironment): void => {
    expect(() => parseRedisRuntimeConfiguration(passwordEnvironment, 'local')).toThrow(
      new InvalidConfigurationError(['REDIS_PASSWORD', 'REDIS_PASSWORD_FILE']),
    );
  });

  it('rejects an empty password without exposing it', (): void => {
    expect(() => parseLocal({ REDIS_PASSWORD: '' })).toThrow(
      new InvalidConfigurationError(['REDIS_PASSWORD']),
    );
  });

  it.each([
    ['REDIS_HOST', 'redis host'],
    ['REDIS_HOST', 'redis://cache.example'],
    ['REDIS_HOST', 'cache.example/0'],
    ['REDIS_HOST', 'cache\u0000example'],
    ['REDIS_HOST', '[::1]'],
    ['REDIS_HOST', 'cache.example:6379'],
    ['REDIS_HOST', 'cache..example'],
    ['REDIS_HOST', '-cache.example'],
    ['REDIS_HOST', 'cache-.example'],
    ['REDIS_HOST', '127.0.0.999'],
    ['REDIS_HOST', '0x7f000001'],
    ['REDIS_HOST', '0x7f.0.0.1'],
    ['REDIS_HOST', 'éxample.test'],
    ['REDIS_USERNAME', 'cache user'],
    ['REDIS_USERNAME', 'cache\u0000user'],
    ['REDIS_USERNAME', 'cache\u0080user'],
    ['REDIS_PORT', '0'],
    ['REDIS_PORT', '65536'],
    ['REDIS_PORT', ' 6379 '],
    ['REDIS_CONNECT_TIMEOUT_MS', '99'],
    ['REDIS_CONNECT_TIMEOUT_MS', '5001'],
    ['REDIS_COMMAND_TIMEOUT_MS', '24'],
    ['REDIS_COMMAND_TIMEOUT_MS', '501'],
    ['REDIS_PROBE_TIMEOUT_MS', '24'],
    ['REDIS_PROBE_TIMEOUT_MS', '5001'],
    ['REDIS_SHUTDOWN_TIMEOUT_MS', '99'],
    ['REDIS_SHUTDOWN_TIMEOUT_MS', '10001'],
    ['REDIS_COMMAND_QUEUE_LIMIT', '0'],
    ['REDIS_COMMAND_QUEUE_LIMIT', '10001'],
    ['REDIS_COMMAND_QUEUE_LIMIT', '1.5'],
  ])('rejects an invalid %s value', (variableName, value): void => {
    expect(() => parseLocal({ [variableName]: value })).toThrow(
      new InvalidConfigurationError([variableName]),
    );
  });

  it('enforces the runtime UTF-8 byte boundary for hosts and usernames', (): void => {
    const exactUsername = 'é'.repeat(64);

    expect(
      parseLocal({
        REDIS_HOST: `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`,
        REDIS_USERNAME: exactUsername,
      }),
    ).toEqual(
      expect.objectContaining({
        username: exactUsername,
      }),
    );

    for (const [variableName, value] of [
      ['REDIS_HOST', `${'a'.repeat(64)}.example`],
      ['REDIS_HOST', `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`],
      ['REDIS_HOST', 'cache\ud800.example'],
      ['REDIS_USERNAME', 'é'.repeat(65)],
      ['REDIS_USERNAME', 'cache\ud800user'],
    ] as const) {
      expect(() => parseLocal({ [variableName]: value })).toThrow(
        new InvalidConfigurationError([variableName]),
      );
    }
  });

  it.each([
    '127.0.0.1',
    '2001:db8::1',
    'redis',
    'cache-1.internal.example',
    'xn--bcher-kva.example',
  ])('accepts canonical IP or ASCII service host %s', (host): void => {
    expect(parseLocal({ REDIS_HOST: host }).host).toBe(host);
  });

  it('enforces canonical UTF-8 and exact byte ceilings for inline secrets', (): void => {
    const exactPassword = 'é'.repeat(4_096);
    const exactCertificateAuthority = 'é'.repeat(524_288);
    const configuration = parseLocal({
      REDIS_PASSWORD: exactPassword,
      REDIS_TLS_MODE: 'verify-identity',
      REDIS_TLS_CA: exactCertificateAuthority,
    });

    expect(configuration.password).toEqual(
      expect.objectContaining({ kind: 'value', value: exactPassword }),
    );
    expect(configuration.tls.mode).toBe('verify-identity');

    if (configuration.tls.mode === 'verify-identity') {
      expect(configuration.tls.certificateAuthority).toEqual({
        kind: 'value',
        value: exactCertificateAuthority,
        variableName: 'REDIS_TLS_CA',
      });
    }

    for (const [variableName, value, overrides] of [
      ['REDIS_PASSWORD', 'é'.repeat(4_097), {}],
      ['REDIS_PASSWORD', 'password\ud800', {}],
      ['REDIS_TLS_CA', 'é'.repeat(524_289), { REDIS_TLS_MODE: 'verify-identity' }],
      ['REDIS_TLS_CA', 'certificate\ud800', { REDIS_TLS_MODE: 'verify-identity' }],
    ] as const) {
      expect(() => parseLocal({ ...overrides, [variableName]: value })).toThrow(
        new InvalidConfigurationError([variableName]),
      );
    }
  });

  it('accepts every numeric boundary and an explicit safe username', (): void => {
    expect(
      parseLocal({
        REDIS_PORT: '65535',
        REDIS_USERNAME: 'oms.api-v1',
        REDIS_CONNECT_TIMEOUT_MS: '5000',
        REDIS_COMMAND_TIMEOUT_MS: '25',
        REDIS_PROBE_TIMEOUT_MS: '5000',
        REDIS_SHUTDOWN_TIMEOUT_MS: '100',
        REDIS_COMMAND_QUEUE_LIMIT: '10000',
      }),
    ).toEqual(
      expect.objectContaining({
        port: 65_535,
        username: 'oms.api-v1',
        connectTimeoutMilliseconds: 5_000,
        commandTimeoutMilliseconds: 25,
        probeTimeoutMilliseconds: 5_000,
        shutdownTimeoutMilliseconds: 100,
        commandQueueLimit: 10_000,
      }),
    );

    expect(
      parseLocal({
        REDIS_PORT: '1',
        REDIS_CONNECT_TIMEOUT_MS: '100',
        REDIS_COMMAND_TIMEOUT_MS: '500',
        REDIS_PROBE_TIMEOUT_MS: '25',
        REDIS_SHUTDOWN_TIMEOUT_MS: '10000',
        REDIS_COMMAND_QUEUE_LIMIT: '1',
      }),
    ).toEqual(
      expect.objectContaining({
        port: 1,
        connectTimeoutMilliseconds: 100,
        commandTimeoutMilliseconds: 500,
        probeTimeoutMilliseconds: 25,
        shutdownTimeoutMilliseconds: 10_000,
        commandQueueLimit: 1,
      }),
    );
  });

  it('rejects disabled TLS in production', (): void => {
    expect(() =>
      parseRedisRuntimeConfiguration(
        {
          REDIS_HOST: 'redis.example',
          REDIS_USERNAME: 'orders_api',
          REDIS_PASSWORD: 'secret',
          REDIS_TLS_MODE: 'disabled',
        },
        'production',
      ),
    ).toThrow(new InvalidConfigurationError(['REDIS_TLS_MODE']));
  });

  it('allows at most one certificate authority source', (): void => {
    expect(() =>
      parseLocal({
        REDIS_TLS_MODE: 'verify-identity',
        REDIS_TLS_CA: trustedCertificate,
        REDIS_TLS_CA_FILE: '/run/secrets/redis-ca',
      }),
    ).toThrow(new InvalidConfigurationError(['REDIS_TLS_CA', 'REDIS_TLS_CA_FILE']));
  });

  it('rejects a certificate authority when TLS is disabled', (): void => {
    expect(() => parseLocal({ REDIS_TLS_CA: trustedCertificate })).toThrow(
      new InvalidConfigurationError(['REDIS_TLS_CA', 'REDIS_TLS_MODE']),
    );
  });

  it('returns deeply frozen source references and TLS configuration', (): void => {
    const configuration = parseLocal({
      REDIS_TLS_MODE: 'verify-identity',
      REDIS_TLS_CA_FILE: 'certificates/redis-ca.pem',
    });

    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.password)).toBe(true);
    expect(Object.isFrozen(configuration.tls)).toBe(true);

    if (configuration.tls.mode === 'verify-identity') {
      expect(Object.isFrozen(configuration.tls.certificateAuthority)).toBe(true);
    }
  });

  it('does not accept a secret-bearing URL as a password source', (): void => {
    expect(() =>
      parseRedisRuntimeConfiguration(
        { REDIS_URL: 'rediss://default:secret@redis.example:6379' },
        'local',
      ),
    ).toThrow(new InvalidConfigurationError(['REDIS_PASSWORD', 'REDIS_PASSWORD_FILE']));
  });

  it('aggregates names while keeping invalid values out of the error', (): void => {
    const secretPassword = 'password-that-must-not-leak';
    const invalidHost = 'https://host-that-must-not-leak';

    expect.assertions(4);

    try {
      parseLocal({
        REDIS_HOST: invalidHost,
        REDIS_PASSWORD: secretPassword,
        REDIS_PASSWORD_FILE: '/secret/path-that-must-not-leak',
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(String(error)).toContain('REDIS_HOST, REDIS_PASSWORD, REDIS_PASSWORD_FILE');
      expect(String(error)).not.toContain(secretPassword);
      expect(String(error)).not.toContain(invalidHost);
    }
  });
});

describe('resolveRedisRuntimeConfiguration', (): void => {
  it('preserves inline secrets and maps verified TLS to driver-ready values', (): void => {
    const readFile = jest.fn((): Uint8Array => Buffer.from('unused'));
    const configuration = parseLocal({
      REDIS_PASSWORD: ' password bytes ',
      REDIS_USERNAME: 'cache-api',
      REDIS_TLS_MODE: 'verify-identity',
      REDIS_TLS_CA: trustedCertificate,
    });

    const resolved = resolveRedisRuntimeConfiguration(configuration, {
      baseDirectory: '/srv/oms',
      readFile,
    });

    expect(resolved).toEqual({
      host: '127.0.0.1',
      port: 6379,
      username: 'cache-api',
      password: ' password bytes ',
      connectTimeoutMilliseconds: 500,
      commandTimeoutMilliseconds: 100,
      probeTimeoutMilliseconds: 500,
      shutdownTimeoutMilliseconds: 1_000,
      commandQueueLimit: 256,
      tls: {
        enabled: true,
        certificateAuthority: trustedCertificate,
      },
    });
    expect(readFile).not.toHaveBeenCalled();
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.tls)).toBe(true);
  });

  it('resolves relative files and removes exactly one terminal line ending', (): void => {
    const readFile = jest.fn((path: string): Uint8Array => {
      const files: Readonly<Record<string, string>> = {
        '/srv/oms/secrets/redis-password': 'password\n\n',
        '/srv/oms/certificates/redis-ca.pem': `${trustedCertificate}\r\n`,
      };
      const value = files[path];

      if (value === undefined) {
        throw new Error('unexpected path');
      }

      return Buffer.from(value, 'utf8');
    });
    const configuration = parseRedisRuntimeConfiguration(
      {
        REDIS_PASSWORD_FILE: 'secrets/redis-password',
        REDIS_TLS_MODE: 'verify-identity',
        REDIS_TLS_CA_FILE: 'certificates/redis-ca.pem',
      },
      'local',
    );

    const resolved = resolveRedisRuntimeConfiguration(configuration, {
      baseDirectory: '/srv/oms',
      readFile,
    });

    expect(resolved.password).toBe('password\n');
    expect(resolved.tls).toEqual({
      enabled: true,
      certificateAuthority: trustedCertificate,
    });
    expect(readFile).toHaveBeenNthCalledWith(1, '/srv/oms/secrets/redis-password', 8_195);
    expect(readFile).toHaveBeenNthCalledWith(2, '/srv/oms/certificates/redis-ca.pem', 1_048_579);
  });

  it('preserves a terminal carriage return that is not part of a line ending', (): void => {
    const configuration = parseRedisRuntimeConfiguration(
      { REDIS_PASSWORD_FILE: 'secrets/redis-password' },
      'test',
    );

    expect(
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Buffer.from('password\r'),
      }).password,
    ).toBe('password\r');
  });

  it('accepts the exact password-file byte ceiling after CRLF and rejects one byte over', (): void => {
    const configuration = parseRedisRuntimeConfiguration(
      { REDIS_PASSWORD_FILE: 'secrets/redis-password' },
      'test',
    );
    const exactPassword = Buffer.alloc(8_192, 0x61);

    expect(
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (_path, maximumBytes): Uint8Array => {
          expect(maximumBytes).toBe(8_195);
          return Buffer.concat([exactPassword, Buffer.from('\r\n')]);
        },
      }).password,
    ).toBe('a'.repeat(8_192));

    expect(() =>
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Buffer.alloc(8_193, 0x61),
      }),
    ).toThrow(new InvalidConfigurationError(['REDIS_PASSWORD_FILE']));
  });

  it('accepts the exact certificate-authority file byte ceiling and rejects one byte over', (): void => {
    const configuration = parseLocal({
      REDIS_TLS_MODE: 'verify-identity',
      REDIS_TLS_CA_FILE: 'certificates/redis-ca.pem',
    });
    const paddingLength = 1_048_576 - Buffer.byteLength(trustedCertificate, 'utf8');
    const exactCertificateAuthority = `${trustedCertificate}${' '.repeat(paddingLength)}`;
    const exactBytes = Buffer.from(exactCertificateAuthority, 'utf8');

    expect(exactBytes).toHaveLength(1_048_576);
    expect(
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (_path, maximumBytes): Uint8Array => {
          expect(maximumBytes).toBe(1_048_579);
          return Buffer.concat([exactBytes, Buffer.from('\n')]);
        },
      }).tls,
    ).toEqual({
      enabled: true,
      certificateAuthority: exactCertificateAuthority,
    });

    expect(() =>
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Buffer.alloc(1_048_577, 0x61),
      }),
    ).toThrow(new InvalidConfigurationError(['REDIS_TLS_CA_FILE']));
  });

  it('rejects malformed and non-canonical UTF-8 secret files', (): void => {
    const passwordConfiguration = parseRedisRuntimeConfiguration(
      { REDIS_PASSWORD_FILE: 'secrets/redis-password' },
      'test',
    );
    const certificateConfiguration = parseLocal({
      REDIS_TLS_MODE: 'verify-identity',
      REDIS_TLS_CA_FILE: 'certificates/redis-ca.pem',
    });

    expect(() =>
      resolveRedisRuntimeConfiguration(passwordConfiguration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Uint8Array.from([0xc0, 0xaf]),
      }),
    ).toThrow(new InvalidConfigurationError(['REDIS_PASSWORD_FILE']));

    expect(() =>
      resolveRedisRuntimeConfiguration(certificateConfiguration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Uint8Array.from([0xef, 0xbb]),
      }),
    ).toThrow(new InvalidConfigurationError(['REDIS_TLS_CA_FILE']));
  });

  it('aggregates hostile unreadable sources without exposing paths or causes', (): void => {
    const passwordPath = 'private/password-do-not-log';
    const certificatePath = 'private/ca-do-not-log.pem';
    const configuration = parseRedisRuntimeConfiguration(
      {
        REDIS_PASSWORD_FILE: passwordPath,
        REDIS_TLS_MODE: 'verify-identity',
        REDIS_TLS_CA_FILE: certificatePath,
      },
      'local',
    );
    const hostileCause = new Error('sensitive provider cause');

    Object.defineProperty(hostileCause, 'toString', {
      get: (): never => {
        throw new Error('hostile cause inspected');
      },
    });

    expect.assertions(5);

    try {
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): never => {
          throw hostileCause;
        },
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error).toHaveProperty(
        'message',
        'Invalid runtime configuration: REDIS_PASSWORD_FILE, REDIS_TLS_CA_FILE',
      );
      expect(String(error)).not.toContain(passwordPath);
      expect(String(error)).not.toContain(certificatePath);
      expect(String(error)).not.toContain('hostile cause inspected');
    }
  });

  it.each([[''], ['\n'], ['\r\n']])(
    'rejects a password file empty after removing one terminal line ending',
    (contents): void => {
      const configuration = parseRedisRuntimeConfiguration(
        { REDIS_PASSWORD_FILE: 'secrets/password' },
        'test',
      );

      expect(() =>
        resolveRedisRuntimeConfiguration(configuration, {
          baseDirectory: '/srv/oms',
          readFile: (): Uint8Array => Buffer.from(contents),
        }),
      ).toThrow(new InvalidConfigurationError(['REDIS_PASSWORD_FILE']));
    },
  );

  it('rejects a malformed certificate authority without exposing its contents', (): void => {
    const malformedCertificate = 'not-a-pem-certificate-that-must-not-leak';
    const configuration = parseLocal({
      REDIS_TLS_MODE: 'verify-identity',
      REDIS_TLS_CA: malformedCertificate,
    });

    expect.assertions(2);

    try {
      resolveRedisRuntimeConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Buffer.alloc(0),
      });
    } catch (error: unknown) {
      expect(error).toEqual(new InvalidConfigurationError(['REDIS_TLS_CA']));
      expect(String(error)).not.toContain(malformedCertificate);
    }
  });

  it('retains an explicit production username after resolution', (): void => {
    const configuration = parseRedisRuntimeConfiguration(
      {
        REDIS_HOST: 'redis.example',
        REDIS_USERNAME: 'orders_api',
        REDIS_PASSWORD: 'secret',
        REDIS_TLS_MODE: 'verify-identity',
      },
      'production',
    );
    const resolved = resolveRedisRuntimeConfiguration(configuration, {
      baseDirectory: '/srv/oms',
      readFile: (): Uint8Array => Buffer.alloc(0),
    });

    expect(resolved.username).toBe('orders_api');
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.tls)).toBe(true);
  });

  it('requires an absolute secret base directory', (): void => {
    expect(() =>
      resolveRedisRuntimeConfiguration(parseLocal(), {
        baseDirectory: 'relative/path',
        readFile: (): Uint8Array => Buffer.alloc(0),
      }),
    ).toThrow(new TypeError('Redis secret base directory must be absolute'));
  });
});
