import { toNodeRedisClientOptions } from '../src/client/node-redis-client.factory';
import { redisOptions } from './redis-client.fixture';

describe('Node Redis client option mapping', (): void => {
  it('selects RESP2, a bounded queue, no offline queue, and no reconnect', (): void => {
    const options = toNodeRedisClientOptions(redisOptions());

    expect(options).toEqual({
      RESP: 2,
      commandsQueueMaxLength: 256,
      disableClientInfo: true,
      disableOfflineQueue: true,
      password: 'redis-test-password',
      socket: {
        connectTimeout: 2_000,
        host: '127.0.0.1',
        port: 6_379,
        reconnectStrategy: false,
        tls: false,
      },
      username: 'oms_app',
    });
    expect(options).not.toHaveProperty('url');
    expect(options).not.toHaveProperty('database');
    expect(options).not.toHaveProperty('keyPrefix');
    expect(options).not.toHaveProperty('clientSideCache');
  });

  it('enables verified TLS with the configured host as server name', (): void => {
    const certificateAuthority = '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----';
    const options = toNodeRedisClientOptions(
      redisOptions({
        host: 'redis.example.test',
        tls: { certificateAuthority, enabled: true },
      }),
    );

    expect(options.socket).toEqual({
      ca: certificateAuthority,
      connectTimeout: 2_000,
      host: 'redis.example.test',
      port: 6_379,
      reconnectStrategy: false,
      rejectUnauthorized: true,
      servername: 'redis.example.test',
      tls: true,
    });
  });

  it('uses platform trust roots when verified TLS has no private authority', (): void => {
    const options = toNodeRedisClientOptions(redisOptions({ tls: { enabled: true } }));

    expect(options.socket).toEqual(
      expect.objectContaining({
        ca: undefined,
        rejectUnauthorized: true,
        tls: true,
      }),
    );
  });

  it.each(['127.0.0.1', '2001:db8::1'])('omits SNI for verified-TLS IP host %s', (host): void => {
    const options = toNodeRedisClientOptions(redisOptions({ host, tls: { enabled: true } }));

    expect(options.socket).toEqual(
      expect.objectContaining({
        host,
        rejectUnauthorized: true,
        tls: true,
      }),
    );
    expect(options.socket).not.toHaveProperty('servername');
  });
});
