import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('@oms/database public surfaces', (): void => {
  it('publishes only the runtime root and the infrastructure-only Prisma surface', (): void => {
    const packageManifest = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as { readonly exports?: Readonly<Record<string, unknown>> };

    expect(Object.keys(packageManifest.exports ?? {}).sort()).toEqual(['.', './prisma']);
  });

  it('does not expose the concrete Prisma client from the runtime root', (): void => {
    const publicSource = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');

    expect(publicSource).not.toContain('PrismaClient');
    expect(publicSource).not.toContain('getPrismaClient');
  });
});
