import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';

import {
  parseDatabaseRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
} from '@oms/configuration';

import { createDatabaseRuntime } from '../src';
import { getPrismaClient } from '../src/prisma';

const repositoryRoot = resolve(__dirname, '../../../..');
const environmentFile = resolve(repositoryRoot, '.env');

if (existsSync(environmentFile)) {
  loadEnvFile(environmentFile);
}

void test('the runtime connects through Prisma and the committed schema is queryable', async () => {
  const unresolved = parseDatabaseRuntimeConfiguration(process.env, 'development');
  const options = resolveDatabaseRuntimeConfiguration(unresolved, {
    baseDirectory: repositoryRoot,
    readFile: (path): string => readFileSync(path, 'utf8'),
  });
  const runtime = createDatabaseRuntime(options);

  try {
    await runtime.connection.probe();
    const result = await getPrismaClient(runtime).$queryRaw<readonly { count: bigint }[]>`
      SELECT COUNT(*) AS count FROM products
    `;

    assert.equal(result.length, 1);
    assert.ok(Number(result[0]?.count) >= 0);
  } finally {
    await runtime.close();
  }
});
