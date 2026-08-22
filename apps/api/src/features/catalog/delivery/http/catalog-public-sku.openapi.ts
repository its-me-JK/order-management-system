import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, type HeadersObject } from '@nestjs/swagger';

import {
  OPENAPI_HEADER_NAMES,
  OPENAPI_SCHEMA_NAMES,
  openApiHeaderReference,
  openApiSchemaReference,
} from '../../../../platform/openapi/openapi.schemas';

import { MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH } from './catalog-public-sku-cursor.codec';
import {
  CATALOG_PUBLIC_SKU_CURSOR_PATTERN,
  CATALOG_PUBLIC_SKU_ID_PATTERN,
  CATALOG_PUBLIC_SKU_LIMIT_PATTERN,
  CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES,
  catalogPublicSkuOpenApiSchemaReference,
} from './catalog-public-sku.openapi.schemas';

const JSON_MEDIA_TYPE = 'application/json';
const PROBLEM_DETAILS_MEDIA_TYPE = 'application/problem+json';

const PUBLIC_READ_RESPONSE_HEADERS: HeadersObject = {
  'Cache-Control': openApiHeaderReference(OPENAPI_HEADER_NAMES.publicReadCacheControl),
  'X-Request-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.requestId),
  'X-Correlation-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.correlationId),
};
const PROBLEM_RESPONSE_HEADERS: HeadersObject = {
  'Cache-Control': openApiHeaderReference(OPENAPI_HEADER_NAMES.problemCacheControl),
  'X-Request-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.requestId),
  'X-Correlation-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.correlationId),
};

function badRequestResponse(): MethodDecorator {
  return ApiResponse({
    status: 400,
    description: 'The identifier, limit, cursor, or query shape is invalid.',
    headers: PROBLEM_RESPONSE_HEADERS,
    content: {
      [PROBLEM_DETAILS_MEDIA_TYPE]: {
        schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.badRequestProblem),
      },
    },
  });
}

function serviceUnavailableResponse(): MethodDecorator {
  return ApiResponse({
    status: 503,
    description: 'The Catalog read store is temporarily unavailable.',
    headers: PROBLEM_RESPONSE_HEADERS,
    content: {
      [PROBLEM_DETAILS_MEDIA_TYPE]: {
        schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.serviceUnavailableProblem),
      },
    },
  });
}

function internalServerErrorResponse(): MethodDecorator {
  return ApiResponse({
    status: 500,
    description: 'The service could not complete the Catalog read.',
    headers: PROBLEM_RESPONSE_HEADERS,
    content: {
      [PROBLEM_DETAILS_MEDIA_TYPE]: {
        schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.internalServerErrorProblem),
      },
    },
  });
}

export function ApiCatalogListPublicSkusOperation(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'catalogListPublicSkus',
      security: [],
      summary: 'List publicly visible Catalog SKUs',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      description: 'Canonical decimal page size. Defaults to 20.',
      schema: {
        type: 'string',
        default: '20',
        minLength: 1,
        maxLength: 3,
        pattern: CATALOG_PUBLIC_SKU_LIMIT_PATTERN,
      },
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      description: 'Opaque exclusive position returned by the preceding page.',
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH,
        pattern: CATALOG_PUBLIC_SKU_CURSOR_PATTERN,
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Public SKUs ordered newest first by their stable seek position.',
      headers: PUBLIC_READ_RESPONSE_HEADERS,
      content: {
        [JSON_MEDIA_TYPE]: {
          schema: catalogPublicSkuOpenApiSchemaReference(
            CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.collectionResponse,
          ),
        },
      },
    }),
    badRequestResponse(),
    serviceUnavailableResponse(),
    internalServerErrorResponse(),
  );
}

export function ApiCatalogGetPublicSkuOperation(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'catalogGetPublicSku',
      security: [],
      summary: 'Get one publicly visible Catalog SKU',
    }),
    ApiParam({
      name: 'skuId',
      required: true,
      description: 'Canonical lowercase UUIDv7 Catalog SKU identifier.',
      schema: {
        type: 'string',
        format: 'uuid',
        pattern: CATALOG_PUBLIC_SKU_ID_PATTERN,
      },
    }),
    ApiResponse({
      status: 200,
      description: 'The public SKU projection.',
      headers: PUBLIC_READ_RESPONSE_HEADERS,
      content: {
        [JSON_MEDIA_TYPE]: {
          schema: catalogPublicSkuOpenApiSchemaReference(
            CATALOG_PUBLIC_SKU_OPENAPI_SCHEMA_NAMES.resourceResponse,
          ),
        },
      },
    }),
    badRequestResponse(),
    ApiResponse({
      status: 404,
      description: 'The SKU is missing or not publicly visible.',
      headers: PROBLEM_RESPONSE_HEADERS,
      content: {
        [PROBLEM_DETAILS_MEDIA_TYPE]: {
          schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.notFoundProblem),
        },
      },
    }),
    serviceUnavailableResponse(),
    internalServerErrorResponse(),
  );
}
