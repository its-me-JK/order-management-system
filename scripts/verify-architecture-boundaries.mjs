import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const architectureRuleIds = new Set([
  'no-restricted-imports',
  'no-restricted-syntax',
  'oms-architecture/enforce-layer-imports',
]);

const rejectedImports = [
  {
    code: "import type { Query } from '../../application/query';\nexport type DomainQuery = Query;",
    expectedMessage: 'Domain code may import only its own domain layer.',
    filePath: 'packages/modules/catalog/src/domain/__architecture_probe__/application.ts',
    name: 'domain -> application',
  },
  {
    code: "import { Injectable } from '@nestjs/common';\nexport const decorator = Injectable;",
    expectedMessage: 'Domain code may import only its own domain layer.',
    filePath: 'packages/modules/catalog/src/domain/__architecture_probe__/framework.ts',
    name: 'domain -> framework/vendor',
  },
  {
    code: "export type Client = import('../../infrastructure/client').Client;",
    expectedMessage: 'Domain code may import only its own domain layer.',
    filePath: 'packages/modules/catalog/src/domain/__architecture_probe__/infrastructure.ts',
    name: 'domain -> infrastructure through an import type expression',
  },
  {
    code: "import type { Adapter } from '../../infrastructure/adapter';\nexport type Port = Adapter;",
    expectedMessage: 'Application code may import only its own application and domain layers.',
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/infrastructure.ts',
    name: 'application -> infrastructure',
  },
  {
    code: "import { Injectable } from '@nestjs/common';\nexport const decorator = Injectable;",
    expectedMessage: 'Application code may import only its own application and domain layers.',
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/framework.ts',
    name: 'application -> framework',
  },
  {
    code: "import type { Request } from 'express';\nexport type Input = Request;",
    expectedMessage: 'Application code may import only its own application and domain layers.',
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/transport.ts',
    name: 'application -> transport',
  },
  {
    code: "import { readFile } from 'fs/promises';\nexport const read = readFile;",
    expectedMessage: 'Application code may import only its own application and domain layers.',
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/node-runtime.ts',
    name: 'application -> unprefixed Node runtime module',
  },
  {
    code: "export const loadCrypto = async () => import('node:crypto');",
    expectedMessage: 'Application code may import only its own application and domain layers.',
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/dynamic-runtime.ts',
    name: 'application -> dynamic Node runtime import',
  },
  {
    code: "import { PrismaCatalogReadRepository } from '@oms/catalog/infrastructure/prisma';\nexport const Repository = PrismaCatalogReadRepository;",
    expectedMessage:
      'API feature delivery code cannot import a business module infrastructure adapter.',
    filePath: 'apps/api/src/features/catalog/__architecture_probe__/infrastructure.ts',
    name: 'API feature delivery -> business infrastructure',
  },
  {
    code: "export const loadRepository = async () => import('@oms/catalog/infrastructure/prisma');",
    expectedMessage:
      'API feature delivery code cannot import a business module infrastructure adapter.',
    filePath: 'apps/api/src/features/catalog/__architecture_probe__/dynamic-infrastructure.ts',
    name: 'API feature delivery -> dynamic business infrastructure import',
  },
  {
    code: "import type { Repository } from 'typeorm';\nexport type Persistence = Repository<unknown>;",
    expectedMessage: 'Application code may import only its own application and domain layers.',
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/unknown-vendor.ts',
    name: 'application -> arbitrary bare vendor',
  },
  {
    code: "import { createPool } from 'mariadb';\nexport const poolFactory = createPool;",
    expectedMessage: 'The MariaDB driver is owned by @oms/database.',
    filePath: 'packages/modules/catalog/src/infrastructure/__architecture_probe__/mariadb.ts',
    name: 'module infrastructure -> direct database driver',
  },
  {
    code: "import type { CatalogReadRepository } from '@oms/catalog';\nexport type Repository = CatalogReadRepository;",
    expectedMessage: 'Application code may import only its own application and domain layers.',
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/package-root.ts',
    name: 'application -> package application barrel',
  },
  {
    code: "export type Catalog = import('../../index').CatalogReadRepository;",
    expectedMessage: 'Domain code may import only its own domain layer.',
    filePath: 'packages/modules/catalog/src/domain/__architecture_probe__/barrel-escape.ts',
    name: 'domain -> package barrel through a normalized relative escape',
  },
  {
    code: "import { PrismaCatalogReadRepository } from '@oms/catalog/src/infrastructure/prisma';\nexport const Repository = PrismaCatalogReadRepository;",
    expectedMessage:
      'API feature delivery code cannot import a business module infrastructure adapter.',
    filePath: 'apps/api/src/features/catalog/__architecture_probe__/source-infrastructure.ts',
    name: 'API feature delivery -> source infrastructure alias',
  },
];

const allowedImports = [
  {
    code: "import { createPool } from 'mariadb';\nexport const poolFactory = createPool;",
    filePath: 'packages/database/src/__architecture_probe__/mariadb.ts',
    name: 'database package -> owned direct database driver',
  },
  {
    code: "import type { Product } from './product';\nexport type CatalogProduct = Product;",
    filePath: 'packages/modules/catalog/src/domain/__architecture_probe__/domain.ts',
    name: 'domain -> same domain',
  },
  {
    code: "import type { Product } from '../../domain/product';\nexport type Result = Product;",
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/domain.ts',
    name: 'application -> domain',
  },
  {
    code: "import type { Query } from '../catalog-query';\nexport type CatalogQuery = Query;",
    filePath: 'packages/modules/catalog/src/application/__architecture_probe__/application.ts',
    name: 'application -> same application',
  },
  {
    code: "import type { CatalogReadRepository } from '@oms/catalog';\nexport type Port = CatalogReadRepository;",
    filePath: 'apps/api/src/features/catalog/__architecture_probe__/application.ts',
    name: 'API feature delivery -> business application surface',
  },
  {
    code: "import { PrismaCatalogReadRepository } from '@oms/catalog/infrastructure/prisma';\nexport const Repository = PrismaCatalogReadRepository;",
    filePath: 'apps/api/src/composition/__architecture_probe__/catalog.providers.ts',
    name: 'API composition root -> business infrastructure',
  },
];

const eslint = new ESLint({
  overrideConfig: [
    {
      ...tseslint.configs.disableTypeChecked,
      files: ['**/__architecture_probe__/**/*.ts'],
    },
  ],
});

const lintProbe = async ({ code, filePath }) => {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });

  assert.ok(result, `ESLint returned no result for ${filePath}`);
  assert.equal(result.fatalErrorCount, 0, `ESLint could not parse architecture probe ${filePath}`);

  return result.messages.filter(({ ruleId }) => ruleId && architectureRuleIds.has(ruleId));
};

for (const rejectedImport of rejectedImports) {
  const messages = await lintProbe(rejectedImport);

  assert.ok(
    messages.some(({ message }) => message.includes(rejectedImport.expectedMessage)),
    `${rejectedImport.name} was not rejected by the expected architecture boundary`,
  );
}

for (const allowedImport of allowedImports) {
  const messages = await lintProbe(allowedImport);

  assert.deepEqual(
    messages,
    [],
    `${allowedImport.name} was unexpectedly rejected: ${messages.map(({ message }) => message).join('; ')}`,
  );
}

console.log(
  `Architecture boundaries verified (${rejectedImports.length} rejected, ${allowedImports.length} allowed).`,
);
