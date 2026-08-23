import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as mysqlTransactionSurface from '../src/mysql-transaction';

const internalExportNames = [
  'InvalidMySqlTransactionParametersError',
  'ManagedMariaDbConnectionLeaseOwner',
  'ManagedMySqlTransactionExecutor',
  'createDatabaseResourcesRuntime',
  'createManagedMariaDbConnectionAllocator',
  'getMySqlTransactionStatementRegistration',
  'getRuntimeMariaDbConnectionLeaseOwner',
] as const;
const mysqlTransactionContractTypeNames = [
  'AnyMySqlTransactionStatement',
  'CreateMySqlTransactionExecutor',
  'MySqlTransactionDirective',
  'MySqlTransactionExecutor',
  'MySqlTransactionExecutorOptions',
  'MySqlTransactionOutcome',
  'MySqlTransactionParameter',
  'MySqlTransactionProgram',
  'MySqlTransactionProgramContext',
  'MySqlTransactionStatement',
  'MySqlTransactionStatementDefinition',
  'MySqlTransactionStatementParameters',
  'MySqlTransactionStatementResult',
] as const;
const mysqlTransactionValueExportNames = [
  'createMySqlTransactionExecutor',
  'defineMySqlTransactionStatement',
] as const;

function readExportedTypeNames(source: string): readonly string[] {
  const match = /export type \{(?<names>[\s\S]*?)\} from '\.\/mysql-transaction\.contract';/u.exec(
    source,
  );

  if (match?.groups?.['names'] === undefined) {
    throw new Error('Expected the MySQL transaction contract type export block');
  }

  return match.groups['names']
    .split(',')
    .map((name): string => name.trim())
    .filter((name): boolean => name.length > 0)
    .sort();
}

describe('@oms/database public surfaces', (): void => {
  it('publishes only the root, Prisma, and closed MySQL transaction subpaths', (): void => {
    const packageManifest = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as { readonly exports?: Readonly<Record<string, unknown>> };

    expect(Object.keys(packageManifest.exports ?? {}).sort()).toEqual([
      '.',
      './mysql-transaction',
      './prisma',
    ]);
    expect(packageManifest.exports?.['./mysql-transaction']).toEqual({
      types: './src/mysql-transaction.ts',
      default: './dist/mysql-transaction.js',
    });
  });

  it.each(['../src/index.ts', '../src/prisma.ts'])('keeps internals out of %s', (path): void => {
    const publicSource = readFileSync(resolve(__dirname, path), 'utf8');

    for (const exportName of internalExportNames) {
      expect(publicSource).not.toContain(exportName);
    }
  });

  it.each(['../src/index.ts', '../src/prisma.ts'])(
    'keeps exact-connection transaction capabilities out of %s',
    (path): void => {
      const publicSource = readFileSync(resolve(__dirname, path), 'utf8');

      for (const exportName of mysqlTransactionValueExportNames) {
        expect(publicSource).not.toContain(exportName);
      }
    },
  );

  it('exports exactly the two supported MySQL transaction runtime factories', (): void => {
    expect(Object.keys(mysqlTransactionSurface).sort()).toEqual(
      [...mysqlTransactionValueExportNames].sort(),
    );
  });

  it('exports exactly the supported closed MySQL transaction contract types', (): void => {
    const publicSource = readFileSync(resolve(__dirname, '../src/mysql-transaction.ts'), 'utf8');

    expect(readExportedTypeNames(publicSource)).toEqual(
      [...mysqlTransactionContractTypeNames].sort(),
    );
    expect(publicSource.match(/^export /gmu)).toHaveLength(3);
    expect(publicSource).not.toContain('export *');

    for (const exportName of internalExportNames) {
      expect(publicSource).not.toContain(exportName);
    }
  });
});
