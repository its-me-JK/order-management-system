import type { DatabaseConnectionOptions } from '../src/database.contract';
import { toPrismaMariaDbPoolOptions } from '../src/client/prisma-client.options';

function connectionOptions(
  overrides: Partial<DatabaseConnectionOptions> = {},
): DatabaseConnectionOptions {
  return {
    acquireTimeoutMilliseconds: 10_000,
    connectTimeoutMilliseconds: 5_000,
    connectionLimit: 5,
    database: 'oms',
    host: '127.0.0.1',
    idleTimeoutSeconds: 300,
    password: 'test-password',
    port: 3306,
    probeTimeoutMilliseconds: 1_000,
    tls: {
      enabled: false,
    },
    user: 'oms_app',
    ...overrides,
  };
}

describe('toPrismaMariaDbPoolOptions', (): void => {
  it('maps bounded pool options and disables TLS by omission', (): void => {
    expect(toPrismaMariaDbPoolOptions(connectionOptions())).toEqual({
      acquireTimeout: 10_000,
      connectTimeout: 5_000,
      connectionLimit: 5,
      database: 'oms',
      host: '127.0.0.1',
      idleTimeout: 300,
      minimumIdle: 1,
      password: 'test-password',
      port: 3306,
      resetAfterUse: true,
      user: 'oms_app',
    });
  });

  it('enables verified TLS with a minimum protocol version and custom authority', (): void => {
    expect(
      toPrismaMariaDbPoolOptions(
        connectionOptions({
          tls: {
            certificateAuthority: 'test-certificate-authority',
            enabled: true,
          },
        }),
      ).ssl,
    ).toEqual({
      ca: 'test-certificate-authority',
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    });
  });
});
