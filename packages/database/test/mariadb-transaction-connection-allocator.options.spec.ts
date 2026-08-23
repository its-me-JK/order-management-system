import type { DatabaseConnectionOptions } from '../src/database.contract';
import { toMariaDbTransactionConnectionAllocatorOptions } from '../src/client/mariadb-transaction-connection-allocator.options';

function connectionOptions(
  overrides: Partial<DatabaseConnectionOptions> = {},
): DatabaseConnectionOptions {
  return {
    acquireTimeoutMilliseconds: 10_000,
    connectTimeoutMilliseconds: 5_000,
    connectionLimit: 5,
    transactionConnectionLimit: 2,
    database: 'oms',
    host: '127.0.0.1',
    idleTimeoutSeconds: 300,
    password: 'test-password',
    port: 3306,
    probeTimeoutMilliseconds: 1_000,
    tls: { enabled: false },
    user: 'oms_app',
    ...overrides,
  };
}

describe('toMariaDbTransactionConnectionAllocatorOptions', (): void => {
  it('uses only the reserved budget and hardens the direct driver boundary', (): void => {
    const options = toMariaDbTransactionConnectionAllocatorOptions(connectionOptions());
    const { logger, ...connection } = options.connection;

    expect({ ...options, connection }).toEqual({
      acquireTimeoutMilliseconds: 10_000,
      connection: {
        allowPublicKeyRetrieval: false,
        bigIntAsNumber: false,
        bulk: false,
        checkNumberRange: true,
        connectTimeout: 5_000,
        database: 'oms',
        dateStrings: true,
        debug: false,
        debugCompress: false,
        decimalAsNumber: false,
        foundRows: false,
        host: '127.0.0.1',
        insertIdAsNumber: false,
        logPackets: false,
        logParam: false,
        multipleStatements: false,
        namedPlaceholders: false,
        password: 'test-password',
        permitLocalInfile: false,
        permitRedirect: false,
        permitSetMultiParamEntries: false,
        pipelining: false,
        port: 3306,
        prepareCacheLength: 0,
        timezone: 'Z',
        trace: false,
        user: 'oms_app',
      },
      connectionLimit: 2,
    });
    expect(logger?.warning).toBeInstanceOf(Function);
    expect(Object.keys(logger ?? {})).toEqual(['warning']);
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.connection)).toBe(true);
    expect(Object.isFrozen(logger)).toBe(true);
  });

  it('propagates verified TLS without weakening certificate checks', (): void => {
    const options = toMariaDbTransactionConnectionAllocatorOptions(
      connectionOptions({
        tls: {
          certificateAuthority: 'test-certificate-authority',
          enabled: true,
        },
      }),
    );

    expect(options.connection.ssl).toEqual({
      ca: 'test-certificate-authority',
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    });
    expect(Object.isFrozen(options.connection.ssl)).toBe(true);
  });

  it('installs neither pool reuse controls nor driver query and socket timeouts', (): void => {
    const options = toMariaDbTransactionConnectionAllocatorOptions(connectionOptions());

    expect(options.connection).not.toHaveProperty('queryTimeout');
    expect(options.connection).not.toHaveProperty('socketTimeout');
    expect(options.connection).not.toHaveProperty('timeout');
    expect(options.connection).not.toHaveProperty('minimumIdle');
    expect(options.connection).not.toHaveProperty('resetAfterUse');
    expect(options.connection).not.toHaveProperty('noControlAfterUse');
  });

  it('rejects non-integral and inverted connection budgets', (): void => {
    expect((): unknown =>
      toMariaDbTransactionConnectionAllocatorOptions(
        connectionOptions({ connectionLimit: 5.5, transactionConnectionLimit: 2 }),
      ),
    ).toThrow(new TypeError('Invalid database connection budget'));
    expect((): unknown =>
      toMariaDbTransactionConnectionAllocatorOptions(
        connectionOptions({ connectionLimit: 5, transactionConnectionLimit: 5 }),
      ),
    ).toThrow(new TypeError('Invalid database connection budget'));
  });
});
