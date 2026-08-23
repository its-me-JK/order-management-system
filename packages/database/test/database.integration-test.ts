import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';

import {
  parseDatabaseRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
} from '@oms/configuration';
import { config as loadEnvironment } from 'dotenv';

import type { DatabaseConnectionOptions } from '../src/database.contract';
import { ManagedMariaDbConnectionAllocatorUnavailableError } from '../src/client/managed-mariadb-connection-lease.owner';
import { createDatabaseRuntime } from '../src';
import { getPrismaClient } from '../src/prisma';
import { getRuntimeMariaDbConnectionLeaseOwner } from '../src/prisma-database.runtime';

function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;

  while (!existsSync(resolve(currentDirectory, 'pnpm-workspace.yaml'))) {
    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error('Unable to locate the repository root');
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

const repositoryRoot = findRepositoryRoot(__dirname);

loadEnvironment({
  path: resolve(repositoryRoot, '.env'),
  quiet: true,
});

function databaseOptions(): DatabaseConnectionOptions {
  const configuration = parseDatabaseRuntimeConfiguration(process.env, 'test');

  return resolveDatabaseRuntimeConfiguration(configuration, {
    baseDirectory: repositoryRoot,
    readFile: (path): string => readFileSync(path, 'utf8'),
  });
}

interface DatabaseContractRow {
  readonly characterSet: string;
  readonly collation: string;
  readonly currentDatabase: string;
  readonly currentUser: string;
  readonly defaultStorageEngine: string;
  readonly sqlMode: string;
  readonly timeZone: string;
  readonly transactionIsolation: string;
  readonly version: string;
  readonly connectionId: bigint | number;
}

interface DirectConnectionContractRow {
  readonly authenticated_as: string;
  readonly connection_id: bigint | number;
  readonly database_name: string;
  readonly session_isolation: string;
  readonly session_zone: string;
}

void test('Prisma connects as the application principal and observes the database contract', async () => {
  const options = databaseOptions();
  const runtime = createDatabaseRuntime(options);
  const client = getPrismaClient(runtime);

  try {
    await runtime.connection.probe();
    await client.$connect();

    const rows = await client.$queryRaw<DatabaseContractRow[]>`
      SELECT
        CONNECTION_ID() AS connectionId,
        VERSION() AS version,
        DATABASE() AS currentDatabase,
        CURRENT_USER() AS currentUser,
        @@SESSION.transaction_isolation AS transactionIsolation,
        @@SESSION.time_zone AS timeZone,
        @@SESSION.sql_mode AS sqlMode,
        @@character_set_server AS characterSet,
        @@collation_server AS collation,
        @@default_storage_engine AS defaultStorageEngine
    `;
    const row = rows[0];

    assert.ok(row);
    assert.deepEqual(
      {
        characterSet: row.characterSet,
        collation: row.collation,
        currentDatabase: row.currentDatabase,
        defaultStorageEngine: row.defaultStorageEngine,
        timeZone: row.timeZone,
        transactionIsolation: row.transactionIsolation,
        version: row.version,
      },
      {
        characterSet: 'utf8mb4',
        collation: 'utf8mb4_0900_ai_ci',
        currentDatabase: options.database,
        defaultStorageEngine: 'InnoDB',
        timeZone: '+00:00',
        transactionIsolation: 'READ-COMMITTED',
        version: '8.4.11',
      },
    );
    assert.equal(row.currentUser, `${options.user}@%`);

    const sqlModes = new Set(row.sqlMode.split(','));

    for (const requiredMode of [
      'ERROR_FOR_DIVISION_BY_ZERO',
      'NO_ENGINE_SUBSTITUTION',
      'NO_ZERO_DATE',
      'NO_ZERO_IN_DATE',
      'ONLY_FULL_GROUP_BY',
      'STRICT_TRANS_TABLES',
    ]) {
      assert.ok(sqlModes.has(requiredMode), `Missing required SQL mode: ${requiredMode}`);
    }

    const grantRows = await client.$queryRaw<Record<string, string>[]>`
      SHOW GRANTS FOR CURRENT_USER()
    `;
    const grants = grantRows.flatMap((grantRow) => Object.values(grantRow)).sort();
    const databaseGrantPattern = options.database.replaceAll('_', '\\_');

    assert.deepEqual(
      grants,
      [
        `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${databaseGrantPattern}\`.* TO \`${options.user}\`@\`%\``,
        `GRANT USAGE ON *.* TO \`${options.user}\`@\`%\``,
      ].sort(),
    );

    const directConnectionOwner = getRuntimeMariaDbConnectionLeaseOwner(runtime);
    const directLease = await directConnectionOwner.acquire();

    try {
      const directConnection = directConnectionOwner.connectionFor(directLease);
      const directRows = await directConnection.query<DirectConnectionContractRow[]>(`
        SELECT
          CONNECTION_ID() AS connection_id,
          DATABASE() AS database_name,
          CURRENT_USER() AS authenticated_as,
          @@SESSION.time_zone AS session_zone,
          @@SESSION.transaction_isolation AS session_isolation
      `);
      const directRow = directRows[0];

      assert.ok(directRow);
      assert.equal(directRow.database_name, options.database);
      assert.equal(directRow.authenticated_as, `${options.user}@%`);
      assert.equal(directRow.session_zone, '+00:00');
      assert.equal(directRow.session_isolation, 'READ-COMMITTED');
      assert.notEqual(String(directRow.connection_id), String(row.connectionId));
    } finally {
      await directConnectionOwner.release(directLease);
    }
  } finally {
    await runtime.close();
  }
});

void test('exact transport quarantine rejects an established in-flight command', async () => {
  const options = databaseOptions();
  const runtime = createDatabaseRuntime(options);
  const directConnectionOwner = getRuntimeMariaDbConnectionLeaseOwner(runtime);

  try {
    const lease = await directConnectionOwner.acquire();
    const directConnection = directConnectionOwner.connectionFor(lease);
    const stalledQuery = directConnection.query<readonly Record<string, number>[]>(
      'SELECT SLEEP(30) AS sleep_result',
    );

    await new Promise<void>((resolveDelay): void => {
      setTimeout(resolveDelay, 50);
    });
    directConnectionOwner.destroy(lease);

    await assert.rejects(stalledQuery, (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'MariaDB connection allocator is unavailable');
      return true;
    });
  } finally {
    await runtime.close();
  }
});

void test('one-use release drains an in-flight command before returning capacity', async () => {
  const options = databaseOptions();
  const runtime = createDatabaseRuntime(options);
  const directConnectionOwner = getRuntimeMariaDbConnectionLeaseOwner(runtime);

  try {
    const lease = await directConnectionOwner.acquire();
    const directConnection = directConnectionOwner.connectionFor(lease);
    const stalledQuery = directConnection.query<readonly Record<string, number>[]>(
      'SELECT SLEEP(30) AS sleep_result',
    );

    await new Promise<void>((resolveDelay): void => {
      setTimeout(resolveDelay, 50);
    });
    const release = directConnectionOwner.release(lease);

    await assert.rejects(stalledQuery, (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'MariaDB connection allocator is unavailable');
      return true;
    });
    await release;

    const replacementLease = await directConnectionOwner.acquire();
    const replacementConnection = directConnectionOwner.connectionFor(replacementLease);
    const replacementRows =
      await replacementConnection.query<readonly { value: bigint }[]>('SELECT 1 AS value');

    assert.equal(replacementRows[0]?.value, 1n);
    await directConnectionOwner.release(replacementLease);
  } finally {
    await runtime.close();
  }
});

void test('expired direct waiters release their bounded queue admission', async () => {
  const options = {
    ...databaseOptions(),
    acquireTimeoutMilliseconds: 100,
  } satisfies DatabaseConnectionOptions;
  const runtime = createDatabaseRuntime(options);
  const directConnectionOwner = getRuntimeMariaDbConnectionLeaseOwner(runtime);

  try {
    await Promise.all(
      Array.from({ length: options.transactionConnectionLimit }, async (): Promise<void> => {
        await directConnectionOwner.acquire();
      }),
    );

    const expiredWaiters = Array.from(
      { length: options.transactionConnectionLimit },
      (): Promise<unknown> => directConnectionOwner.acquire(),
    );
    await Promise.all(
      expiredWaiters.map(async (waiter): Promise<void> => {
        await assert.rejects(waiter, ManagedMariaDbConnectionAllocatorUnavailableError);
      }),
    );

    const replacementWaiters = Array.from(
      { length: options.transactionConnectionLimit },
      (): Promise<'accepted' | 'rejected'> =>
        directConnectionOwner.acquire().then(
          (): 'accepted' => 'accepted',
          (): 'rejected' => 'rejected',
        ),
    );
    const overflowWaiter = directConnectionOwner.acquire();

    await new Promise<void>((resolveImmediate): void => {
      setImmediate(resolveImmediate);
    });
    assert.deepEqual(
      await Promise.all(
        replacementWaiters.map((waiter) =>
          Promise.race([waiter, Promise.resolve('pending' as const)]),
        ),
      ),
      ['pending', 'pending'],
    );
    await assert.rejects(overflowWaiter, ManagedMariaDbConnectionAllocatorUnavailableError);

    const close = runtime.close();
    assert.deepEqual(await Promise.all(replacementWaiters), ['rejected', 'rejected']);
    await close;
  } finally {
    await runtime.close();
  }
});

void test('the direct reserve queues at its limit and terminal shutdown rejects further checkout', async () => {
  const options = databaseOptions();
  const runtime = createDatabaseRuntime(options);
  const directConnectionOwner = getRuntimeMariaDbConnectionLeaseOwner(runtime);

  try {
    for (let index = 0; index < options.transactionConnectionLimit; index += 1) {
      await directConnectionOwner.acquire();
    }

    const queuedAcquisition = directConnectionOwner.acquire();

    await Promise.resolve();

    const runtimeClose = runtime.close();
    const connectionClose = runtime.connection.close();

    assert.equal(connectionClose, runtimeClose);
    await assert.rejects(queuedAcquisition, ManagedMariaDbConnectionAllocatorUnavailableError);
    await runtimeClose;
    assert.throws(
      () => directConnectionOwner.acquire(),
      ManagedMariaDbConnectionAllocatorUnavailableError,
    );
    assert.equal(runtime.close(), runtimeClose);
  } finally {
    await runtime.close();
  }
});
