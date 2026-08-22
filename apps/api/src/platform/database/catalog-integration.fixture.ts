import { BinaryUuidCodec } from '@oms/catalog/infrastructure/identifiers';
import type { DatabaseRuntime } from '@oms/database';
import { getPrismaClient, type PrismaClient } from '@oms/database/prisma';

const PRODUCT_CREATED_AT = '9998-12-31 00:00:00.000000';
const PRODUCT_ACTIVATED_AT = '9998-12-31 00:00:00.000001';
const PRODUCT_UPDATED_AT = '9999-12-31 23:59:59.999999';

export const CATALOG_HTTP_INTEGRATION_FIXTURE = Object.freeze({
  activeProduct: Object.freeze({
    id: 'eeeeeeee-ee00-7000-8000-000000000001',
    name: 'HTTP integration active product',
  }),
  draftProduct: Object.freeze({
    id: 'eeeeeeee-ee00-7000-8000-000000000002',
    name: 'HTTP integration draft product',
  }),
  visibleSkus: Object.freeze([
    Object.freeze({
      code: 'ITAPI-PAGE-01',
      createdAt: '9999-12-31 23:59:59.999999',
      id: 'eeeeeeee-ee10-7fff-bfff-ffffffffffff',
      name: 'HTTP integration visible SKU 1',
    }),
    Object.freeze({
      code: 'ITAPI-PAGE-02',
      createdAt: '9999-12-31 23:59:59.999999',
      id: 'eeeeeeee-ee10-7fff-bfff-fffffffffffe',
      name: 'HTTP integration visible SKU 2',
    }),
    Object.freeze({
      code: 'ITAPI-PAGE-03',
      createdAt: '9999-12-31 23:59:59.999998',
      id: 'eeeeeeee-ee10-7fff-bfff-fffffffffffd',
      name: 'HTTP integration visible SKU 3',
    }),
  ]),
  hiddenSkus: Object.freeze({
    activeUnderDraftProduct: Object.freeze({
      code: 'ITAPI-HIDDEN-PRODUCT-DRAFT',
      id: 'eeeeeeee-ee10-7000-8000-000000000003',
      name: 'HTTP integration SKU under draft Product',
    }),
    draft: Object.freeze({
      code: 'ITAPI-HIDDEN-DRAFT',
      id: 'eeeeeeee-ee10-7000-8000-000000000001',
      name: 'HTTP integration draft SKU',
    }),
    retired: Object.freeze({
      code: 'ITAPI-HIDDEN-RETIRED',
      id: 'eeeeeeee-ee10-7000-8000-000000000002',
      name: 'HTTP integration retired SKU',
    }),
  }),
  missingSkuId: 'eeeeeeee-ee10-7000-8000-000000000099',
});

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

const OWNED_PRODUCT_IDS = [
  CATALOG_HTTP_INTEGRATION_FIXTURE.activeProduct.id,
  CATALOG_HTTP_INTEGRATION_FIXTURE.draftProduct.id,
] as const;
const OWNED_SKU_IDS = [
  ...CATALOG_HTTP_INTEGRATION_FIXTURE.visibleSkus.map(({ id }) => id),
  ...Object.values(CATALOG_HTTP_INTEGRATION_FIXTURE.hiddenSkus).map(({ id }) => id),
] as const;

async function insertProduct(
  client: PrismaClient,
  codec: BinaryUuidCodec,
  row: ProductWrite,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO catalog_products (
      id, name, status, version, created_at, updated_at, activated_at, archived_at
    ) VALUES (
      ${codec.toBytes(row.id)},
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

async function insertSku(
  client: PrismaClient,
  codec: BinaryUuidCodec,
  row: SkuWrite,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO catalog_skus (
      id, product_id, code, name, status, version,
      created_at, updated_at, activated_at, retired_at
    ) VALUES (
      ${codec.toBytes(row.id)},
      ${codec.toBytes(row.productId)},
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

/** Removes only rows owned by the Catalog HTTP integration fixture. */
export async function cleanupCatalogHttpIntegrationFixture(
  runtime: DatabaseRuntime,
): Promise<void> {
  const client = getPrismaClient(runtime);
  const codec = new BinaryUuidCodec();

  await client.catalogSkuRecord.deleteMany({
    where: {
      id: {
        in: OWNED_SKU_IDS.map((id) => codec.toBytes(id)),
      },
    },
  });
  await client.catalogProductRecord.deleteMany({
    where: {
      id: {
        in: OWNED_PRODUCT_IDS.map((id) => codec.toBytes(id)),
      },
    },
  });
}

/** Seeds deterministic active and hidden rows through the runtime owned by the API. */
export async function seedCatalogHttpIntegrationFixture(runtime: DatabaseRuntime): Promise<void> {
  const client = getPrismaClient(runtime);
  const codec = new BinaryUuidCodec();
  const fixture = CATALOG_HTTP_INTEGRATION_FIXTURE;

  await cleanupCatalogHttpIntegrationFixture(runtime);
  await insertProduct(client, codec, {
    activatedAt: PRODUCT_ACTIVATED_AT,
    archivedAt: null,
    createdAt: PRODUCT_CREATED_AT,
    id: fixture.activeProduct.id,
    name: fixture.activeProduct.name,
    status: 'ACTIVE',
    updatedAt: PRODUCT_UPDATED_AT,
    version: 1,
  });
  await insertProduct(client, codec, {
    activatedAt: null,
    archivedAt: null,
    createdAt: PRODUCT_CREATED_AT,
    id: fixture.draftProduct.id,
    name: fixture.draftProduct.name,
    status: 'DRAFT',
    updatedAt: PRODUCT_CREATED_AT,
    version: 1,
  });

  for (const sku of fixture.visibleSkus) {
    await insertSku(client, codec, {
      activatedAt: sku.createdAt,
      code: sku.code,
      createdAt: sku.createdAt,
      id: sku.id,
      name: sku.name,
      productId: fixture.activeProduct.id,
      retiredAt: null,
      status: 'ACTIVE',
      updatedAt: PRODUCT_UPDATED_AT,
      version: 1,
    });
  }

  await insertSku(client, codec, {
    activatedAt: null,
    code: fixture.hiddenSkus.draft.code,
    createdAt: '9999-12-31 23:59:59.999990',
    id: fixture.hiddenSkus.draft.id,
    name: fixture.hiddenSkus.draft.name,
    productId: fixture.activeProduct.id,
    retiredAt: null,
    status: 'DRAFT',
    updatedAt: '9999-12-31 23:59:59.999990',
    version: 1,
  });
  await insertSku(client, codec, {
    activatedAt: '9999-12-31 23:59:59.999990',
    code: fixture.hiddenSkus.retired.code,
    createdAt: '9999-12-31 23:59:59.999990',
    id: fixture.hiddenSkus.retired.id,
    name: fixture.hiddenSkus.retired.name,
    productId: fixture.activeProduct.id,
    retiredAt: '9999-12-31 23:59:59.999991',
    status: 'RETIRED',
    updatedAt: '9999-12-31 23:59:59.999991',
    version: 2,
  });
  await insertSku(client, codec, {
    activatedAt: '9999-12-31 23:59:59.999990',
    code: fixture.hiddenSkus.activeUnderDraftProduct.code,
    createdAt: '9999-12-31 23:59:59.999990',
    id: fixture.hiddenSkus.activeUnderDraftProduct.id,
    name: fixture.hiddenSkus.activeUnderDraftProduct.name,
    productId: fixture.draftProduct.id,
    retiredAt: null,
    status: 'ACTIVE',
    updatedAt: '9999-12-31 23:59:59.999990',
    version: 1,
  });
}
