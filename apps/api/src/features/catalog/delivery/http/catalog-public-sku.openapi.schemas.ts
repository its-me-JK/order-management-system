import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';

import { MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH } from './catalog-public-sku-cursor.codec';

export const CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES = Object.freeze({
  collectionResponse: 'CatalogPublicSkuCollectionResponse',
  pageInfo: 'CatalogPublicSkuPageInfo',
  product: 'CatalogPublicSkuProduct',
  resource: 'CatalogPublicSku',
  resourceResponse: 'CatalogPublicSkuResourceResponse',
});

export const CATALOG_PUBLIC_SKU_ID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const CATALOG_PUBLIC_SKU_CURSOR_PATTERN = '^[A-Za-z0-9_-]+$';
export const CATALOG_PUBLIC_SKU_LIMIT_PATTERN = '^(?:[1-9]|[1-9][0-9]|100)$';

type CatalogPublicSkuOpenApiSchemaName =
  (typeof CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES)[keyof typeof CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES];

export function catalogPublicSkuOpenApiSchemaReference(
  name: CatalogPublicSkuOpenApiSchemaName,
): ReferenceObject {
  return { $ref: `#/components/schemas/${name}` };
}

const skuIdentifierSchema: SchemaObject = {
  type: 'string',
  format: 'uuid',
  pattern: CATALOG_PUBLIC_SKU_ID_PATTERN,
};

export const CATALOG_PUBLIC_SKU_OPENAPI_SCHEMAS: Readonly<Record<string, SchemaObject>> =
  Object.freeze({
    [CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.product]: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: skuIdentifierSchema,
        name: { type: 'string', minLength: 1, maxLength: 160 },
      },
      required: ['id', 'name'],
    },
    [CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.resource]: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: skuIdentifierSchema,
        code: {
          type: 'string',
          minLength: 3,
          maxLength: 64,
          pattern: '^[A-Z0-9][A-Z0-9._-]{2,63}$',
        },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        product: catalogPublicSkuOpenApiSchemaReference(
          CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.product,
        ),
      },
      required: ['id', 'code', 'name', 'product'],
    },
    [CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.resourceResponse]: {
      type: 'object',
      additionalProperties: false,
      properties: {
        data: catalogPublicSkuOpenApiSchemaReference(
          CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.resource,
        ),
      },
      required: ['data'],
    },
    [CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.pageInfo]: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nextCursor: {
          type: 'string',
          nullable: true,
          minLength: 1,
          maxLength: MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH,
          pattern: CATALOG_PUBLIC_SKU_CURSOR_PATTERN,
        },
      },
      required: ['nextCursor'],
    },
    [CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.collectionResponse]: {
      type: 'object',
      additionalProperties: false,
      properties: {
        data: {
          type: 'array',
          maxItems: 100,
          items: catalogPublicSkuOpenApiSchemaReference(
            CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.resource,
          ),
        },
        pageInfo: catalogPublicSkuOpenApiSchemaReference(
          CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.pageInfo,
        ),
      },
      required: ['data', 'pageInfo'],
    },
  });
