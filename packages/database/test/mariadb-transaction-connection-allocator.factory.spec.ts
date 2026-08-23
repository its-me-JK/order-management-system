import { createServer, type Server, type Socket } from 'node:net';

import type { DatabaseConnectionOptions } from '../src/database.contract';
import { createManagedMariaDbConnectionAllocator } from '../src/client/mariadb-transaction-connection-allocator.factory';
import { toMariaDbTransactionConnectionAllocatorOptions } from '../src/client/mariadb-transaction-connection-allocator.options';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve): void => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value): void => resolvePromise?.(value),
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => {
      server.removeListener('error', reject);
      const address = server.address();

      if (address === null || typeof address === 'string') {
        reject(new Error('Expected a TCP server address'));
        return;
      }

      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject): void => {
    server.close((error): void => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function connectionOptions(port: number): DatabaseConnectionOptions {
  return {
    acquireTimeoutMilliseconds: 2_000,
    connectTimeoutMilliseconds: 1_500,
    connectionLimit: 3,
    transactionConnectionLimit: 2,
    database: 'oms',
    host: '127.0.0.1',
    idleTimeoutSeconds: 300,
    password: 'not-sent-to-a-database',
    port,
    probeTimeoutMilliseconds: 1_000,
    tls: { enabled: false },
    user: 'oms_app',
  };
}

describe('createManagedMariaDbConnectionAllocator', (): void => {
  it('closes a live handshake transport before terminal allocator shutdown resolves', async (): Promise<void> => {
    const accepted = deferred<Socket>();
    const peerClosed = deferred<undefined>();
    const server = createServer((socket): void => {
      accepted.resolve(socket);
      socket.once('close', (): void => {
        peerClosed.resolve(undefined);
      });
    });
    const port = await listen(server);
    const allocator = createManagedMariaDbConnectionAllocator(
      toMariaDbTransactionConnectionAllocatorOptions(connectionOptions(port)),
    );
    const acquisition = allocator.getConnection();
    const acquisitionOutcome = acquisition.catch((): undefined => undefined);
    let peer: Socket | undefined;

    try {
      peer = await accepted.promise;
      const close = allocator.end();

      await expect(close).resolves.toBeUndefined();
      await expect(acquisitionOutcome).resolves.toBeUndefined();
      await expect(peerClosed.promise).resolves.toBeUndefined();
      expect(peer.destroyed).toBe(true);
    } finally {
      peer?.destroy();
      await closeServer(server);
    }
  });

  it('bounds queued work to one waiter per reserved slot without opening extra transports', async (): Promise<void> => {
    const capacityReached = deferred<undefined>();
    const peers: Socket[] = [];
    const peerClosures: Promise<void>[] = [];
    const server = createServer((socket): void => {
      peers.push(socket);
      peerClosures.push(
        new Promise((resolve): void => {
          socket.once('close', (): void => {
            resolve();
          });
        }),
      );
      if (peers.length === 2) capacityReached.resolve(undefined);
    });
    const port = await listen(server);
    const allocator = createManagedMariaDbConnectionAllocator(
      toMariaDbTransactionConnectionAllocatorOptions(connectionOptions(port)),
    );
    const acquisitions = [
      allocator.getConnection(),
      allocator.getConnection(),
      allocator.getConnection(),
      allocator.getConnection(),
    ];
    const outcomes = acquisitions.map((acquisition) =>
      acquisition.catch((): undefined => undefined),
    );
    const overflow = allocator.getConnection();

    try {
      await capacityReached.promise;
      await expect(overflow).rejects.toThrow('MariaDB connection allocator is unavailable');
      await new Promise<void>((resolve): void => {
        setImmediate(resolve);
      });
      expect(peers).toHaveLength(2);

      const close = allocator.end();

      await expect(Promise.all(outcomes)).resolves.toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      await expect(close).resolves.toBeUndefined();
      await Promise.all(peerClosures);
      expect(peers.every((peer): boolean => peer.destroyed)).toBe(true);
    } finally {
      for (const peer of peers) peer.destroy();
      await closeServer(server);
    }
  });

  it('rejects transport options whose endpoint cannot be owned explicitly', (): void => {
    const options = toMariaDbTransactionConnectionAllocatorOptions(connectionOptions(3306));

    expect(() =>
      createManagedMariaDbConnectionAllocator({ ...options, connectionLimit: 0 }),
    ).toThrow(new TypeError('Invalid MariaDB connection allocator configuration'));
  });
});
