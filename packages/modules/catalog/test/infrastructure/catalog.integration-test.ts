import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

import {
  parseDatabaseRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
} from '@oms/configuration';
import {
  createDatabaseRuntime,
  type DatabaseConnectionOptions,
  type DatabaseRuntime,
} from '@oms/database';
import { getPrismaClient, Prisma, type PrismaClient } from '@oms/database/prisma';
import { config as loadEnvironment } from 'dotenv';

import {
  CatalogReadUnavailableError,
  parseCatalogCursorTimestamp,
  parseCatalogPageSize,
  parseCatalogSkuId,
} from '../../src';
import { BinaryUuidCodec } from '../../src/infrastructure/identifiers';
import { PrismaCatalogReadRepository } from '../../src/infrastructure/prisma';

const PRODUCT_IDS = {
  active: 'ffffffff-ff00-7000-8000-000000000001',
  archived: 'ffffffff-ff00-7000-8000-000000000003',
  constraint: 'ffffffff-ff00-7000-8000-000000000004',
  draft: 'ffffffff-ff00-7000-8000-000000000002',
  invalid: 'ffffffff-ff00-7000-8000-000000000005',
} as const;

const SKU_IDS = {
  activeUnderArchivedProduct: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000004'),
  activeUnderDraftProduct: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000003'),
  constraint: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000005'),
  directRetired: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000006'),
  draft: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000001'),
  duplicate: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000008'),
  invalid: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000007'),
  missingProduct: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000009'),
  page1: parseCatalogSkuId('ffffffff-ffff-7fff-bfff-ffffffffffff'),
  page2: parseCatalogSkuId('ffffffff-ffff-7fff-bfff-fffffffffffe'),
  page3: parseCatalogSkuId('ffffffff-ffff-7fff-bfff-fffffffffffd'),
  page4: parseCatalogSkuId('ffffffff-ffff-7fff-bfff-fffffffffffc'),
  page5: parseCatalogSkuId('ffffffff-ffff-7fff-bfff-fffffffffffb'),
  page6: parseCatalogSkuId('ffffffff-ffff-7fff-bfff-fffffffffffa'),
  retired: parseCatalogSkuId('ffffffff-ff10-7000-8000-000000000002'),
} as const;

const MINIMUM_UUID_V7 = parseCatalogSkuId('00000000-0000-7000-8000-000000000000');
const CATALOG_INTEGRATION_CONFIRMATION_VARIABLE = 'CATALOG_INTEGRATION_CONFIRM_DATABASE';
const CATALOG_INTEGRATION_DATABASE = 'oms_catalog_integration';
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const PRODUCT_CREATED_AT = '9998-12-31 00:00:00.000000';
const PRODUCT_ACTIVATED_AT = '9998-12-31 00:00:00.000001';
const PRODUCT_UPDATED_AT = '9999-12-31 23:59:59.999999';
const HIDDEN_SKU_CREATED_AT = '9999-12-31 23:59:59.998998';
const HIDDEN_SKU_RETIRED_AT = '9999-12-31 23:59:59.998999';

const PAGE_ROWS = [
  {
    code: 'ITCAT-PAGE-01',
    createdAt: '9999-12-31 23:59:59.999999',
    cursorCreatedAt: '9999-12-31T23:59:59.999999Z',
    id: SKU_IDS.page1,
  },
  {
    code: 'ITCAT-PAGE-02',
    createdAt: '9999-12-31 23:59:59.999999',
    cursorCreatedAt: '9999-12-31T23:59:59.999999Z',
    id: SKU_IDS.page2,
  },
  {
    code: 'ITCAT-PAGE-03',
    createdAt: '9999-12-31 23:59:59.999999',
    cursorCreatedAt: '9999-12-31T23:59:59.999999Z',
    id: SKU_IDS.page3,
  },
  {
    code: 'ITCAT-PAGE-04',
    createdAt: '9999-12-31 23:59:59.999998',
    cursorCreatedAt: '9999-12-31T23:59:59.999998Z',
    id: SKU_IDS.page4,
  },
  {
    code: 'ITCAT-PAGE-05',
    createdAt: '9999-12-31 23:59:59.999997',
    cursorCreatedAt: '9999-12-31T23:59:59.999997Z',
    id: SKU_IDS.page5,
  },
  {
    code: 'ITCAT-PAGE-06',
    createdAt: '9999-12-31 23:59:59.998999',
    cursorCreatedAt: '9999-12-31T23:59:59.998999Z',
    id: SKU_IDS.page6,
  },
] as const;

const OWNED_PRODUCT_IDS = Object.values(PRODUCT_IDS);
const OWNED_SKU_IDS = Object.values(SKU_IDS);

type ProductWrite = Readonly<{
  activatedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  version: number;
}>;

type SkuWrite = Readonly<{
  activatedAt: string | null;
  code: string;
  createdAt: string;
  id: string;
  name: string;
  productId: string;
  retiredAt: string | null;
  status: string;
  updatedAt: string;
  version: number;
}>;

type IntegrationContext = Readonly<{
  client: PrismaClient;
  codec: BinaryUuidCodec;
  options: DatabaseConnectionOptions;
  repository: PrismaCatalogReadRepository;
  runtime: DatabaseRuntime;
}>;

type DescriptorRow = Readonly<{ descriptor: string }>;

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

  const options = resolveDatabaseRuntimeConfiguration(configuration, {
    baseDirectory: repositoryRoot,
    readFile: (path): string => readFileSync(path, 'utf8'),
  });

  const confirmedDatabase = process.env[CATALOG_INTEGRATION_CONFIRMATION_VARIABLE];
  const isLocalPlaintextTarget =
    LOOPBACK_DATABASE_HOSTS.has(options.host) &&
    !options.tls.enabled &&
    options.database === CATALOG_INTEGRATION_DATABASE;

  if (!isLocalPlaintextTarget || confirmedDatabase !== options.database) {
    throw new Error(
      'Catalog integration tests require the dedicated loopback, non-TLS database and ' +
        CATALOG_INTEGRATION_CONFIRMATION_VARIABLE +
        ' equal to the configured database name',
    );
  }

  return options;
}

async function openContext(): Promise<IntegrationContext> {
  const options = databaseOptions();
  const runtime = createDatabaseRuntime(options);
  const client = getPrismaClient(runtime);

  await runtime.connection.probe();
  await client.$connect();

  return {
    client,
    codec: new BinaryUuidCodec(),
    options,
    repository: new PrismaCatalogReadRepository(client),
    runtime,
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo | null;

  if (address === null) {
    throw new Error('Stalled Catalog database test server did not bind');
  }

  return address.port;
}

async function closeServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }

  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolveClose, reject): void => {
    server.close((error): void => {
      if (error === undefined) {
        resolveClose();
      } else {
        reject(error);
      }
    });
  });
}

async function cleanupOwnedRows(context: IntegrationContext): Promise<void> {
  await context.client.catalogSkuRecord.deleteMany({
    where: {
      id: {
        in: OWNED_SKU_IDS.map((id) => context.codec.toBytes(id)),
      },
    },
  });
  await context.client.catalogProductRecord.deleteMany({
    where: {
      id: {
        in: OWNED_PRODUCT_IDS.map((id) => context.codec.toBytes(id)),
      },
    },
  });
}

async function insertProduct(context: IntegrationContext, row: ProductWrite): Promise<void> {
  await context.client.$executeRaw`
    INSERT INTO catalog_products (
      id, name, status, version, created_at, updated_at, activated_at, archived_at
    ) VALUES (
      ${context.codec.toBytes(row.id)},
      ${row.name},
      ${row.status},
      ${row.version},
      CAST(${row.createdAt} AS DATETIME(6)),
      CAST(${row.updatedAt} AS DATETIME(6)),
      CAST(${row.activatedAt} AS DATETIME(6)),
      CAST(${row.archivedAt} AS DATETIME(6))
    )
  `;
}

async function insertSku(context: IntegrationContext, row: SkuWrite): Promise<void> {
  await context.client.$executeRaw`
    INSERT INTO catalog_skus (
      id, product_id, code, name, status, version,
      created_at, updated_at, activated_at, retired_at
    ) VALUES (
      ${context.codec.toBytes(row.id)},
      ${context.codec.toBytes(row.productId)},
      ${row.code},
      ${row.name},
      ${row.status},
      ${row.version},
      CAST(${row.createdAt} AS DATETIME(6)),
      CAST(${row.updatedAt} AS DATETIME(6)),
      CAST(${row.activatedAt} AS DATETIME(6)),
      CAST(${row.retiredAt} AS DATETIME(6))
    )
  `;
}

async function expectRawWriteRejected(
  write: () => Promise<unknown>,
  expectedDatabaseMarker: string,
  description: string,
): Promise<void> {
  await assert.rejects(
    write,
    (error: unknown): boolean => {
      assert.ok(error instanceof Prisma.PrismaClientKnownRequestError, description);
      assert.equal(error.code, 'P2010', description);
      assert.ok(error.message.includes(expectedDatabaseMarker), description);
      return true;
    },
    description,
  );
}

function draftProduct(id: string, name = 'Integration draft product'): ProductWrite {
  return {
    activatedAt: null,
    archivedAt: null,
    createdAt: PRODUCT_CREATED_AT,
    id,
    name,
    status: 'DRAFT',
    updatedAt: PRODUCT_CREATED_AT,
    version: 1,
  };
}

function draftSku(
  id: string,
  productId: string,
  code: string,
  name = 'Integration draft SKU',
): SkuWrite {
  return {
    activatedAt: null,
    code,
    createdAt: PRODUCT_CREATED_AT,
    id,
    name,
    productId,
    retiredAt: null,
    status: 'DRAFT',
    updatedAt: PRODUCT_CREATED_AT,
    version: 1,
  };
}

async function assertSchemaContract(context: IntegrationContext): Promise<void> {
  const principalRows = await context.client.$queryRaw<readonly { currentUser: string }[]>`
    SELECT CURRENT_USER() AS currentUser
  `;
  assert.equal(principalRows[0]?.currentUser, `${context.options.user}@%`);

  const tableRows = await context.client.$queryRaw<DescriptorRow[]>`
    SELECT CONCAT(TABLE_NAME, '|', ENGINE, '|', TABLE_COLLATION) AS descriptor
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('catalog_products', 'catalog_skus')
    ORDER BY TABLE_NAME
  `;
  assert.deepEqual(
    tableRows.map(({ descriptor }) => descriptor),
    ['catalog_products|InnoDB|utf8mb4_0900_ai_ci', 'catalog_skus|InnoDB|utf8mb4_0900_ai_ci'],
  );

  const columnRows = await context.client.$queryRaw<DescriptorRow[]>`
    SELECT CONCAT(
      TABLE_NAME, '|', COLUMN_NAME, '|', COLUMN_TYPE, '|', IS_NULLABLE, '|',
      COALESCE(CAST(COLUMN_DEFAULT AS CHAR), 'NULL'), '|',
      COALESCE(COLLATION_NAME, 'NULL'), '|',
      COALESCE(CAST(DATETIME_PRECISION AS CHAR), 'NULL')
    ) AS descriptor
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('catalog_products', 'catalog_skus')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `;
  assert.deepEqual(
    columnRows.map(({ descriptor }) => descriptor),
    [
      'catalog_products|id|binary(16)|NO|NULL|NULL|NULL',
      'catalog_products|name|varchar(160)|NO|NULL|utf8mb4_0900_ai_ci|NULL',
      'catalog_products|status|varchar(16)|NO|NULL|ascii_bin|NULL',
      'catalog_products|version|int unsigned|NO|1|NULL|NULL',
      'catalog_products|created_at|datetime(6)|NO|NULL|NULL|6',
      'catalog_products|updated_at|datetime(6)|NO|NULL|NULL|6',
      'catalog_products|activated_at|datetime(6)|YES|NULL|NULL|6',
      'catalog_products|archived_at|datetime(6)|YES|NULL|NULL|6',
      'catalog_skus|id|binary(16)|NO|NULL|NULL|NULL',
      'catalog_skus|product_id|binary(16)|NO|NULL|NULL|NULL',
      'catalog_skus|code|varchar(64)|NO|NULL|ascii_bin|NULL',
      'catalog_skus|name|varchar(160)|NO|NULL|utf8mb4_0900_ai_ci|NULL',
      'catalog_skus|status|varchar(16)|NO|NULL|ascii_bin|NULL',
      'catalog_skus|version|int unsigned|NO|1|NULL|NULL',
      'catalog_skus|created_at|datetime(6)|NO|NULL|NULL|6',
      'catalog_skus|updated_at|datetime(6)|NO|NULL|NULL|6',
      'catalog_skus|activated_at|datetime(6)|YES|NULL|NULL|6',
      'catalog_skus|retired_at|datetime(6)|YES|NULL|NULL|6',
    ],
  );

  const constraintRows = await context.client.$queryRaw<DescriptorRow[]>`
    SELECT CONCAT(TABLE_NAME, '|', CONSTRAINT_NAME, '|', CONSTRAINT_TYPE, '|', ENFORCED)
      AS descriptor
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('catalog_products', 'catalog_skus')
    ORDER BY TABLE_NAME, CONSTRAINT_NAME
  `;
  assert.deepEqual(
    constraintRows.map(({ descriptor }) => descriptor),
    [
      'catalog_products|ck_catalog_products_lifecycle|CHECK|YES',
      'catalog_products|ck_catalog_products_name_nonblank|CHECK|YES',
      'catalog_products|ck_catalog_products_status|CHECK|YES',
      'catalog_products|ck_catalog_products_timestamp_order|CHECK|YES',
      'catalog_products|ck_catalog_products_version|CHECK|YES',
      'catalog_products|PRIMARY|PRIMARY KEY|YES',
      'catalog_skus|ck_catalog_skus_code_format|CHECK|YES',
      'catalog_skus|ck_catalog_skus_lifecycle|CHECK|YES',
      'catalog_skus|ck_catalog_skus_name_nonblank|CHECK|YES',
      'catalog_skus|ck_catalog_skus_status|CHECK|YES',
      'catalog_skus|ck_catalog_skus_timestamp_order|CHECK|YES',
      'catalog_skus|ck_catalog_skus_version|CHECK|YES',
      'catalog_skus|fk_catalog_skus_product|FOREIGN KEY|YES',
      'catalog_skus|PRIMARY|PRIMARY KEY|YES',
      'catalog_skus|uq_catalog_skus_code|UNIQUE|YES',
    ],
  );

  const indexRows = await context.client.$queryRaw<DescriptorRow[]>`
    SELECT CONCAT(
      TABLE_NAME, '|', INDEX_NAME, '|', NON_UNIQUE, '|', SEQ_IN_INDEX, '|', COLUMN_NAME
    ) AS descriptor
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('catalog_products', 'catalog_skus')
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
  `;
  assert.deepEqual(
    indexRows.map(({ descriptor }) => descriptor),
    [
      'catalog_products|PRIMARY|0|1|id',
      'catalog_skus|ix_catalog_skus_product_status_traversal|1|1|product_id',
      'catalog_skus|ix_catalog_skus_product_status_traversal|1|2|status',
      'catalog_skus|ix_catalog_skus_product_status_traversal|1|3|created_at',
      'catalog_skus|ix_catalog_skus_product_status_traversal|1|4|id',
      'catalog_skus|ix_catalog_skus_public_traversal|1|1|status',
      'catalog_skus|ix_catalog_skus_public_traversal|1|2|created_at',
      'catalog_skus|ix_catalog_skus_public_traversal|1|3|id',
      'catalog_skus|PRIMARY|0|1|id',
      'catalog_skus|uq_catalog_skus_code|0|1|code',
    ],
  );

  const foreignKeyRows = await context.client.$queryRaw<DescriptorRow[]>`
    SELECT CONCAT(
      rc.CONSTRAINT_NAME, '|', rc.TABLE_NAME, '|', kcu.COLUMN_NAME, '|',
      rc.REFERENCED_TABLE_NAME, '|', kcu.REFERENCED_COLUMN_NAME, '|',
      rc.UPDATE_RULE, '|', rc.DELETE_RULE
    ) AS descriptor
    FROM information_schema.REFERENTIAL_CONSTRAINTS AS rc
    INNER JOIN information_schema.KEY_COLUMN_USAGE AS kcu
      ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
      AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
    WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
      AND rc.CONSTRAINT_NAME = 'fk_catalog_skus_product'
  `;
  assert.deepEqual(foreignKeyRows, [
    {
      descriptor:
        'fk_catalog_skus_product|catalog_skus|product_id|catalog_products|id|RESTRICT|RESTRICT',
    },
  ]);
}

async function assertSchemaBehavior(context: IntegrationContext): Promise<void> {
  await cleanupOwnedRows(context);
  await insertProduct(context, {
    activatedAt: PRODUCT_ACTIVATED_AT,
    archivedAt: null,
    createdAt: PRODUCT_CREATED_AT,
    id: PRODUCT_IDS.constraint,
    name: 'Integration constraint product',
    status: 'ACTIVE',
    updatedAt: PRODUCT_UPDATED_AT,
    version: 1,
  });
  await insertSku(context, {
    activatedAt: PRODUCT_ACTIVATED_AT,
    code: 'ITCAT-CONSTRAINT-01',
    createdAt: PRODUCT_CREATED_AT,
    id: SKU_IDS.constraint,
    name: 'Integration constraint SKU',
    productId: PRODUCT_IDS.constraint,
    retiredAt: null,
    status: 'ACTIVE',
    updatedAt: PRODUCT_UPDATED_AT,
    version: 1,
  });

  const invalidNames = [
    ['', 'empty'],
    [' leading', 'leading ASCII space'],
    ['trailing ', 'trailing ASCII space'],
    ['\tleading', 'leading tab'],
    ['trailing\n', 'trailing newline'],
    ['internal\u0007control', 'internal control character'],
    ['\u00a0leading', 'leading non-breaking space'],
    ['trailing\u2003', 'trailing Unicode em space'],
  ] as const;

  for (const [name, description] of invalidNames) {
    await expectRawWriteRejected(
      () => insertProduct(context, draftProduct(PRODUCT_IDS.invalid, name)),
      'ck_catalog_products_name_nonblank',
      `Product must reject ${description}`,
    );
    await expectRawWriteRejected(
      () =>
        insertSku(
          context,
          draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, 'ITCAT-INVALID-NAME', name),
        ),
      'ck_catalog_skus_name_nonblank',
      `SKU must reject ${description}`,
    );
  }

  await expectRawWriteRejected(
    () => insertProduct(context, draftProduct(PRODUCT_IDS.invalid, 'A'.repeat(161))),
    'Data too long',
    'Product must reject a name longer than 160 characters',
  );
  await expectRawWriteRejected(
    () =>
      insertSku(
        context,
        draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, 'ITCAT-LONG-NAME', 'A'.repeat(161)),
      ),
    'Data too long',
    'SKU must reject a name longer than 160 characters',
  );

  for (const code of ['AB', 'itcat-lowercase', '-ITCAT-LEADING', 'ITCAT SPACE']) {
    await expectRawWriteRejected(
      () => insertSku(context, draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, code)),
      'ck_catalog_skus_code_format',
      `SKU must reject invalid code ${code}`,
    );
  }

  await expectRawWriteRejected(
    () =>
      insertSku(
        context,
        draftSku(SKU_IDS.duplicate, PRODUCT_IDS.constraint, 'ITCAT-CONSTRAINT-01'),
      ),
    'uq_catalog_skus_code',
    'SKU code must be globally unique',
  );

  await expectRawWriteRejected(
    () => insertProduct(context, { ...draftProduct(PRODUCT_IDS.invalid), status: 'DISABLED' }),
    'ck_catalog_products_',
    'Product status must use the closed lifecycle set',
  );
  await expectRawWriteRejected(
    () =>
      insertSku(context, {
        ...draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, 'ITCAT-INVALID-STATUS'),
        status: 'DISABLED',
      }),
    'ck_catalog_skus_',
    'SKU status must use the closed lifecycle set',
  );
  await expectRawWriteRejected(
    () => insertProduct(context, { ...draftProduct(PRODUCT_IDS.invalid), version: 0 }),
    'ck_catalog_products_version',
    'Product version must start at one',
  );
  await expectRawWriteRejected(
    () =>
      insertSku(context, {
        ...draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, 'ITCAT-INVALID-VERSION'),
        version: 0,
      }),
    'ck_catalog_skus_version',
    'SKU version must start at one',
  );

  await expectRawWriteRejected(
    () =>
      insertProduct(context, {
        ...draftProduct(PRODUCT_IDS.invalid),
        status: 'ACTIVE',
      }),
    'ck_catalog_products_lifecycle',
    'An active Product requires an activation timestamp',
  );
  await expectRawWriteRejected(
    () =>
      insertSku(context, {
        ...draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, 'ITCAT-INVALID-LIFECYCLE'),
        status: 'ACTIVE',
      }),
    'ck_catalog_skus_lifecycle',
    'An active SKU requires an activation timestamp',
  );
  await expectRawWriteRejected(
    () =>
      insertSku(context, {
        ...draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, 'ITCAT-NO-RETIRED-AT'),
        status: 'RETIRED',
      }),
    'ck_catalog_skus_lifecycle',
    'A retired SKU requires a retirement timestamp',
  );
  await expectRawWriteRejected(
    () =>
      insertProduct(context, {
        ...draftProduct(PRODUCT_IDS.invalid),
        updatedAt: '9997-12-31 00:00:00.000000',
      }),
    'ck_catalog_products_timestamp_order',
    'Product timestamps must be monotonic',
  );
  await expectRawWriteRejected(
    () =>
      insertSku(context, {
        ...draftSku(SKU_IDS.invalid, PRODUCT_IDS.constraint, 'ITCAT-INVALID-TIME'),
        retiredAt: '9997-12-31 00:00:00.000000',
        status: 'RETIRED',
      }),
    'ck_catalog_skus_timestamp_order',
    'SKU timestamps must be monotonic',
  );

  await expectRawWriteRejected(
    () =>
      insertSku(
        context,
        draftSku(SKU_IDS.missingProduct, PRODUCT_IDS.invalid, 'ITCAT-MISSING-PRODUCT'),
      ),
    'fk_catalog_skus_product',
    'An SKU requires an existing Product',
  );
  await expectRawWriteRejected(
    () => context.client.$executeRaw`
      DELETE FROM catalog_products
      WHERE id = ${context.codec.toBytes(PRODUCT_IDS.constraint)}
    `,
    'fk_catalog_skus_product',
    'The Product foreign key must restrict deletion',
  );
  await expectRawWriteRejected(
    () => context.client.$executeRaw`
      UPDATE catalog_products
      SET id = ${context.codec.toBytes(PRODUCT_IDS.invalid)}
      WHERE id = ${context.codec.toBytes(PRODUCT_IDS.constraint)}
    `,
    'fk_catalog_skus_product',
    'The Product foreign key must restrict identifier updates',
  );

  await insertSku(
    context,
    draftSku(SKU_IDS.directRetired, PRODUCT_IDS.constraint, 'ITCAT-DIRECT-RETIRED'),
  );
  await context.client.$executeRaw`
    UPDATE catalog_skus
    SET
      status = 'RETIRED',
      retired_at = CAST('9999-01-01 00:00:00.000001' AS DATETIME(6)),
      updated_at = CAST('9999-01-01 00:00:00.000001' AS DATETIME(6)),
      version = version + 1
    WHERE id = ${context.codec.toBytes(SKU_IDS.directRetired)}
  `;
  const directlyRetired = await context.client.catalogSkuRecord.findUnique({
    select: { activatedAt: true, retiredAt: true, status: true, version: true },
    where: { id: context.codec.toBytes(SKU_IDS.directRetired) },
  });
  assert.ok(directlyRetired);
  assert.equal(directlyRetired.status, 'RETIRED');
  assert.equal(directlyRetired.activatedAt, null);
  assert.ok(directlyRetired.retiredAt);
  assert.equal(directlyRetired.version, 2);

  assert.equal(
    await context.client.catalogProductRecord.count({
      where: { id: context.codec.toBytes(PRODUCT_IDS.invalid) },
    }),
    0,
  );
  assert.equal(
    await context.client.catalogSkuRecord.count({
      where: {
        id: {
          in: [
            context.codec.toBytes(SKU_IDS.invalid),
            context.codec.toBytes(SKU_IDS.duplicate),
            context.codec.toBytes(SKU_IDS.missingProduct),
          ],
        },
      },
    }),
    0,
  );
}

async function insertPublicReadFixtures(context: IntegrationContext): Promise<void> {
  await cleanupOwnedRows(context);
  await insertProduct(context, {
    activatedAt: PRODUCT_ACTIVATED_AT,
    archivedAt: null,
    createdAt: PRODUCT_CREATED_AT,
    id: PRODUCT_IDS.active,
    name: 'Integration active product',
    status: 'ACTIVE',
    updatedAt: PRODUCT_UPDATED_AT,
    version: 1,
  });
  await insertProduct(context, draftProduct(PRODUCT_IDS.draft, 'Integration draft product'));
  await insertProduct(context, {
    activatedAt: PRODUCT_ACTIVATED_AT,
    archivedAt: '9999-01-01 00:00:00.000000',
    createdAt: PRODUCT_CREATED_AT,
    id: PRODUCT_IDS.archived,
    name: 'Integration archived product',
    status: 'ARCHIVED',
    updatedAt: PRODUCT_UPDATED_AT,
    version: 2,
  });

  for (const [index, row] of PAGE_ROWS.entries()) {
    await insertSku(context, {
      activatedAt: row.createdAt,
      code: row.code,
      createdAt: row.createdAt,
      id: row.id,
      name: `Integration page SKU ${String(index + 1)}`,
      productId: PRODUCT_IDS.active,
      retiredAt: null,
      status: 'ACTIVE',
      updatedAt: PRODUCT_UPDATED_AT,
      version: 1,
    });
  }

  await insertSku(context, {
    ...draftSku(SKU_IDS.draft, PRODUCT_IDS.active, 'ITCAT-HIDDEN-DRAFT'),
    createdAt: HIDDEN_SKU_CREATED_AT,
    updatedAt: HIDDEN_SKU_CREATED_AT,
  });
  await insertSku(context, {
    ...draftSku(SKU_IDS.retired, PRODUCT_IDS.active, 'ITCAT-HIDDEN-RETIRED'),
    createdAt: HIDDEN_SKU_CREATED_AT,
    retiredAt: HIDDEN_SKU_RETIRED_AT,
    status: 'RETIRED',
    updatedAt: HIDDEN_SKU_RETIRED_AT,
  });
  await insertSku(context, {
    activatedAt: HIDDEN_SKU_CREATED_AT,
    code: 'ITCAT-HIDDEN-PRODUCT-DRAFT',
    createdAt: HIDDEN_SKU_CREATED_AT,
    id: SKU_IDS.activeUnderDraftProduct,
    name: 'Integration SKU under draft Product',
    productId: PRODUCT_IDS.draft,
    retiredAt: null,
    status: 'ACTIVE',
    updatedAt: PRODUCT_UPDATED_AT,
    version: 1,
  });
  await insertSku(context, {
    activatedAt: HIDDEN_SKU_CREATED_AT,
    code: 'ITCAT-HIDDEN-PRODUCT-ARCHIVED',
    createdAt: HIDDEN_SKU_CREATED_AT,
    id: SKU_IDS.activeUnderArchivedProduct,
    name: 'Integration SKU under archived Product',
    productId: PRODUCT_IDS.archived,
    retiredAt: null,
    status: 'ACTIVE',
    updatedAt: PRODUCT_UPDATED_AT,
    version: 1,
  });
}

async function assertPublicReadAdapter(context: IntegrationContext): Promise<void> {
  await insertPublicReadFixtures(context);

  const visible = await context.repository.getPublicSkuById({ skuId: SKU_IDS.page1 });
  assert.deepEqual(visible, {
    kind: 'found',
    sku: {
      code: 'ITCAT-PAGE-01',
      id: SKU_IDS.page1,
      name: 'Integration page SKU 1',
      product: {
        id: PRODUCT_IDS.active,
        name: 'Integration active product',
      },
    },
  });

  for (const skuId of [
    SKU_IDS.draft,
    SKU_IDS.retired,
    SKU_IDS.activeUnderDraftProduct,
    SKU_IDS.activeUnderArchivedProduct,
    SKU_IDS.missingProduct,
  ]) {
    assert.deepEqual(await context.repository.getPublicSkuById({ skuId }), {
      kind: 'not-found',
    });
  }

  const firstPage = await context.repository.listPublicSkus({
    after: null,
    limit: parseCatalogPageSize(2),
  });
  assert.deepEqual(
    firstPage.items.map(({ id }) => id),
    [SKU_IDS.page1, SKU_IDS.page2],
  );
  const firstCursor = firstPage.pageInfo.nextCursor;
  assert.ok(firstCursor);
  assert.deepEqual(firstCursor, {
    createdAt: parseCatalogCursorTimestamp(PAGE_ROWS[1].cursorCreatedAt),
    id: SKU_IDS.page2,
  });

  const secondPage = await context.repository.listPublicSkus({
    after: firstCursor,
    limit: parseCatalogPageSize(2),
  });
  assert.deepEqual(
    secondPage.items.map(({ id }) => id),
    [SKU_IDS.page3, SKU_IDS.page4],
  );
  const secondCursor = secondPage.pageInfo.nextCursor;
  assert.ok(secondCursor);
  assert.deepEqual(secondCursor, {
    createdAt: parseCatalogCursorTimestamp(PAGE_ROWS[3].cursorCreatedAt),
    id: SKU_IDS.page4,
  });

  const thirdPage = await context.repository.listPublicSkus({
    after: secondCursor,
    limit: parseCatalogPageSize(2),
  });
  assert.deepEqual(
    thirdPage.items.map(({ id }) => id),
    [SKU_IDS.page5, SKU_IDS.page6],
  );

  const traversedIds = [...firstPage.items, ...secondPage.items, ...thirdPage.items].map(
    ({ id }) => id,
  );
  assert.deepEqual(
    traversedIds,
    PAGE_ROWS.map(({ id }) => id),
  );
  assert.equal(new Set(traversedIds).size, PAGE_ROWS.length);

  const afterTaskRows = await context.repository.listPublicSkus({
    after: {
      createdAt: parseCatalogCursorTimestamp(PAGE_ROWS[5].cursorCreatedAt),
      id: SKU_IDS.page6,
    },
    limit: parseCatalogPageSize(100),
  });
  const taskIds = new Set<string>(PAGE_ROWS.map(({ id }) => id));
  const hiddenIds = new Set<string>([
    SKU_IDS.draft,
    SKU_IDS.retired,
    SKU_IDS.activeUnderDraftProduct,
    SKU_IDS.activeUnderArchivedProduct,
  ]);
  assert.equal(
    afterTaskRows.items.some(({ id }) => taskIds.has(id)),
    false,
  );
  assert.equal(
    afterTaskRows.items.some(({ id }) => hiddenIds.has(id)),
    false,
  );

  const beyondEnd = await context.repository.listPublicSkus({
    after: {
      createdAt: parseCatalogCursorTimestamp('1000-01-01T00:00:00.000000Z'),
      id: MINIMUM_UUID_V7,
    },
    limit: parseCatalogPageSize(100),
  });
  assert.deepEqual(beyondEnd, { items: [], pageInfo: { nextCursor: null } });

  const binaryRows = await context.client.$queryRaw<readonly { idHex: string }[]>`
    SELECT HEX(id) AS idHex
    FROM catalog_skus
    WHERE id = ${context.codec.toBytes(SKU_IDS.page1)}
  `;
  assert.equal(binaryRows[0]?.idHex, SKU_IDS.page1.replaceAll('-', '').toUpperCase());
}

async function assertRealOutagesAreUnavailable(context: IntegrationContext): Promise<void> {
  const sockets = new Set<Socket>();
  const server = createServer((socket): void => {
    sockets.add(socket);
    socket.once('close', (): void => {
      sockets.delete(socket);
    });
  });
  const port = await listen(server);
  const runtime = createDatabaseRuntime({
    ...context.options,
    acquireTimeoutMilliseconds: 500,
    connectTimeoutMilliseconds: 100,
    connectionLimit: 1,
    host: '127.0.0.1',
    port,
    tls: { enabled: false },
  });
  const client = getPrismaClient(runtime);
  const repository = new PrismaCatalogReadRepository(client);

  try {
    await assert.rejects(
      repository.getPublicSkuById({ skuId: SKU_IDS.page1 }),
      (error: unknown): boolean => {
        assert.ok(error instanceof CatalogReadUnavailableError);
        assert.equal(error.message, 'Catalog reads are temporarily unavailable');
        assert.ok(error.cause instanceof Prisma.PrismaClientKnownRequestError);
        assert.equal(error.cause.code, 'P2039');
        return true;
      },
    );
    await assert.rejects(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(1) }),
      (error: unknown): boolean => {
        assert.ok(error instanceof CatalogReadUnavailableError);
        assert.equal(error.message, 'Catalog reads are temporarily unavailable');
        assert.ok(error.cause instanceof Prisma.PrismaClientKnownRequestError);
        assert.equal(error.cause.code, 'P2010');
        return true;
      },
    );
  } finally {
    await closeServer(server, sockets);
    await runtime.close();
  }
}

void test('Catalog migration and Prisma read adapter satisfy the MySQL contract', async (context) => {
  const integration = await openContext();

  try {
    await cleanupOwnedRows(integration);

    await context.test('uses the exact reviewed schema as the application principal', async () => {
      await assertSchemaContract(integration);
    });
    await context.test(
      'enforces lifecycle, format, uniqueness, and referential invariants',
      async () => {
        await assertSchemaBehavior(integration);
      },
    );
    await context.test('reads only public rows with lossless seek pagination', async () => {
      await assertPublicReadAdapter(integration);
    });
    await context.test('classifies real adapter connection failures as unavailable', async () => {
      await assertRealOutagesAreUnavailable(integration);
    });
  } finally {
    await cleanupOwnedRows(integration);
    await integration.runtime.close();
  }
});
