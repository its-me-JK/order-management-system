import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const internalExportNames = [
  'ManagedMariaDbConnectionLeaseOwner',
  'createDatabaseResourcesRuntime',
  'getRuntimeMariaDbConnectionLeaseOwner',
  'createManagedMariaDbConnectionAllocator',
] as const;

describe('@oms/database public surfaces', (): void => {
  it('publishes no direct-allocator package subpath', (): void => {
    const packageManifest = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as { readonly exports?: Readonly<Record<string, unknown>> };

    expect(Object.keys(packageManifest.exports ?? {}).sort()).toEqual(['.', './prisma']);
  });

  it.each(['../src/index.ts', '../src/prisma.ts'])('keeps internals out of %s', (path): void => {
    const publicSource = readFileSync(resolve(__dirname, path), 'utf8');

    for (const exportName of internalExportNames) {
      expect(publicSource).not.toContain(exportName);
    }
  });
});
