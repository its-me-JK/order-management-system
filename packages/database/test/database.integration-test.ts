import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

import {
  createPrismaClient,
  type PrismaClientConnectionOptions,
} from '../src/client/prisma-client.factory';

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

function environmentValue(name: string, fallback: string): string {
  const value = process.env[name]?.trim();

  return value === undefined || value === '' ? fallback : value;
}

function positiveIntegerEnvironmentValue(name: string, fallback: number): number {
  const rawValue = environmentValue(name, String(fallback));
  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function databaseOptions(): PrismaClientConnectionOptions {
  const passwordFile = resolve(
    repositoryRoot,
    environmentValue('MYSQL_APP_PASSWORD_FILE', '.local/secrets/mysql-app-password'),
  );
  const password = readFileSync(passwordFile, 'utf8').trim();

  if (password === '') {
    throw new Error('The configured MySQL application password file is empty');
  }

  return {
    acquireTimeoutMilliseconds: positiveIntegerEnvironmentValue(
      'DATABASE_ACQUIRE_TIMEOUT_MS',
      10_000,
    ),
    connectTimeoutMilliseconds: positiveIntegerEnvironmentValue(
      'DATABASE_CONNECT_TIMEOUT_MS',
      5_000,
    ),
    connectionLimit: positiveIntegerEnvironmentValue('DATABASE_CONNECTION_LIMIT', 5),
    database: environmentValue('MYSQL_DATABASE', 'oms'),
    host: environmentValue('DATABASE_HOST', '127.0.0.1'),
    idleTimeoutSeconds: positiveIntegerEnvironmentValue('DATABASE_IDLE_TIMEOUT_SECONDS', 300),
    password,
    port: positiveIntegerEnvironmentValue('MYSQL_PORT', 3306),
    user: environmentValue('MYSQL_USER', 'oms_app'),
  };
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
}

void test('Prisma connects as the application principal and observes the database contract', async () => {
  const options = databaseOptions();
  const client = createPrismaClient(options);

  try {
    await client.$connect();

    const rows = await client.$queryRaw<DatabaseContractRow[]>`
      SELECT
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
  } finally {
    await client.$disconnect();
  }
});
