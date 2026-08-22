import { isPrismaDatabaseUnavailableError, type PrismaClient } from '@oms/database/prisma';

import { parseCatalogCursorTimestamp } from '../../application/catalog-cursor';
import {
  CatalogReadPersistenceError,
  CatalogReadUnavailableError,
} from '../../application/catalog-read.errors';
import type {
  CatalogReadRepository,
  ListPublicSkusQuery,
  PublicSkuPage,
} from '../../application/catalog-read.repository';
import type { PublicSku } from '../../application/public-sku';
import { BinaryUuidCodec } from '../identifiers';

const ACTIVE_STATUS = 'ACTIVE';
type CatalogSkuLookupClient = Pick<PrismaClient['catalogSkuRecord'], 'findUnique'>;

/** The only Prisma capabilities required by the public Catalog read adapter. */
export type CatalogPrismaReadClient = Readonly<{
  $queryRaw: PrismaClient['$queryRaw'];
  catalogSkuRecord: CatalogSkuLookupClient;
}>;

type UnknownRecord = Readonly<Record<string, unknown>>;

type MappedListRow = Readonly<{
  createdAt: ReturnType<typeof parseCatalogCursorTimestamp>;
  sku: PublicSku;
}>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord, key: string): string {
  const value = record[key];

  if (typeof value !== 'string') {
    throw new TypeError(`Catalog persistence field ${key} must be a string`);
  }

  return value;
}

function requiredBytes(record: UnknownRecord, key: string): Uint8Array {
  const value = record[key];

  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`Catalog persistence field ${key} must contain binary UUID bytes`);
  }

  return value;
}

function mapLookupRecord(value: unknown, uuidCodec: BinaryUuidCodec): PublicSku {
  if (!isRecord(value)) {
    throw new TypeError('Catalog persistence returned an invalid SKU record');
  }

  const product = value['product'];

  if (!isRecord(product)) {
    throw new TypeError('Catalog persistence returned an invalid Product record');
  }

  return {
    code: requiredString(value, 'code'),
    id: uuidCodec.fromBytes(requiredBytes(value, 'id')),
    name: requiredString(value, 'name'),
    product: {
      id: uuidCodec.fromBytes(requiredBytes(product, 'id')),
      name: requiredString(product, 'name'),
    },
  };
}

function mapListRow(value: unknown, uuidCodec: BinaryUuidCodec): MappedListRow {
  if (!isRecord(value)) {
    throw new TypeError('Catalog persistence returned an invalid list row');
  }

  return {
    createdAt: parseCatalogCursorTimestamp(requiredString(value, 'cursor_created_at')),
    sku: {
      code: requiredString(value, 'sku_code'),
      id: uuidCodec.fromBytes(requiredBytes(value, 'sku_id')),
      name: requiredString(value, 'sku_name'),
      product: {
        id: uuidCodec.fromBytes(requiredBytes(value, 'product_id')),
        name: requiredString(value, 'product_name'),
      },
    },
  };
}

function translatePersistenceError(error: unknown): never {
  if (isPrismaDatabaseUnavailableError(error)) {
    throw new CatalogReadUnavailableError(error);
  }

  throw new CatalogReadPersistenceError(error);
}

function rowsFromRawResult(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Catalog persistence returned an invalid list result');
  }

  return value;
}

function toMySqlDateTime6(value: ReturnType<typeof parseCatalogCursorTimestamp>): string {
  return `${value.slice(0, 10)} ${value.slice(11, -1)}`;
}

/** Prisma implementation of the application-owned public Catalog read port. */
export class PrismaCatalogReadRepository implements CatalogReadRepository {
  public constructor(
    private readonly client: CatalogPrismaReadClient,
    private readonly uuidCodec = new BinaryUuidCodec(),
  ) {}

  public async getPublicSkuById(
    query: Parameters<CatalogReadRepository['getPublicSkuById']>[0],
  ): ReturnType<CatalogReadRepository['getPublicSkuById']> {
    const skuId = this.uuidCodec.toBytes(query.skuId);

    try {
      const record: unknown = await this.client.catalogSkuRecord.findUnique({
        select: {
          code: true,
          id: true,
          name: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        where: {
          id: skuId,
          product: {
            is: {
              status: ACTIVE_STATUS,
            },
          },
          status: ACTIVE_STATUS,
        },
      });

      if (record === null) {
        return { kind: 'not-found' };
      }

      return {
        kind: 'found',
        sku: mapLookupRecord(record, this.uuidCodec),
      };
    } catch (error: unknown) {
      return translatePersistenceError(error);
    }
  }

  public async listPublicSkus(query: ListPublicSkusQuery): Promise<PublicSkuPage> {
    const cursor =
      query.after === null
        ? null
        : {
            id: this.uuidCodec.toBytes(query.after.id),
            timestamp: toMySqlDateTime6(parseCatalogCursorTimestamp(query.after.createdAt)),
          };

    try {
      const take = query.limit + 1;
      const rawResult: unknown =
        cursor === null
          ? await this.client.$queryRaw`
              SELECT
                s.id AS sku_id,
                s.code AS sku_code,
                s.name AS sku_name,
                p.id AS product_id,
                p.name AS product_name,
                DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS cursor_created_at
              FROM catalog_skus AS s
              INNER JOIN catalog_products AS p ON p.id = s.product_id
              WHERE s.status = ${ACTIVE_STATUS}
                AND p.status = ${ACTIVE_STATUS}
              ORDER BY s.created_at DESC, s.id DESC
              LIMIT ${take}
            `
          : await this.client.$queryRaw`
              SELECT
                s.id AS sku_id,
                s.code AS sku_code,
                s.name AS sku_name,
                p.id AS product_id,
                p.name AS product_name,
                DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS cursor_created_at
              FROM catalog_skus AS s
              INNER JOIN catalog_products AS p ON p.id = s.product_id
              WHERE s.status = ${ACTIVE_STATUS}
                AND p.status = ${ACTIVE_STATUS}
                AND (
                  s.created_at < CAST(${cursor.timestamp} AS DATETIME(6))
                  OR (
                    s.created_at = CAST(${cursor.timestamp} AS DATETIME(6))
                    AND s.id < ${cursor.id}
                  )
                )
              ORDER BY s.created_at DESC, s.id DESC
              LIMIT ${take}
            `;

      const mappedRows = rowsFromRawResult(rawResult).map((row): MappedListRow =>
        mapListRow(row, this.uuidCodec),
      );
      const hasNextPage = mappedRows.length > query.limit;
      const visibleRows = hasNextPage ? mappedRows.slice(0, query.limit) : mappedRows;
      const finalVisibleRow = visibleRows.at(-1);

      return {
        items: visibleRows.map(({ sku }): PublicSku => sku),
        pageInfo:
          hasNextPage && finalVisibleRow !== undefined
            ? {
                nextCursor: {
                  createdAt: finalVisibleRow.createdAt,
                  id: finalVisibleRow.sku.id,
                },
              }
            : { nextCursor: null },
      };
    } catch (error: unknown) {
      return translatePersistenceError(error);
    }
  }
}
