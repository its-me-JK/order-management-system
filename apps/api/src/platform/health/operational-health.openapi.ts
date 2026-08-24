import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse, type HeadersObject } from '@nestjs/swagger';

import {
  OPENAPI_HEADER_NAMES,
  OPENAPI_SCHEMA_NAMES,
  openApiHeaderReference,
  openApiSchemaReference,
} from '../openapi/openapi.schemas';

const JSON_MEDIA_TYPE = 'application/json';
const PROBLEM_DETAILS_MEDIA_TYPE = 'application/problem+json';

const OPERATIONAL_RESPONSE_HEADERS: HeadersObject = {
  'Cache-Control': openApiHeaderReference(OPENAPI_HEADER_NAMES.operationalHealthCacheControl),
  'X-Request-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.requestId),
  'X-Correlation-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.correlationId),
};
const PROBLEM_RESPONSE_HEADERS: HeadersObject = {
  'Cache-Control': openApiHeaderReference(OPENAPI_HEADER_NAMES.problemCacheControl),
  'X-Request-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.requestId),
  'X-Correlation-Id': openApiHeaderReference(OPENAPI_HEADER_NAMES.correlationId),
};

function internalServerErrorResponse(): MethodDecorator {
  return ApiResponse({
    status: 500,
    description: 'An unexpected health adapter failure.',
    headers: PROBLEM_RESPONSE_HEADERS,
    content: {
      [PROBLEM_DETAILS_MEDIA_TYPE]: {
        schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.internalServerErrorProblem),
      },
    },
  });
}

export function ApiLivenessOperation(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'healthGetLiveness',
      summary: 'Report whether the API process can handle HTTP requests',
    }),
    ApiResponse({
      status: 200,
      description: 'The API process is serving requests.',
      headers: OPERATIONAL_RESPONSE_HEADERS,
      content: {
        [JSON_MEDIA_TYPE]: {
          schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.livenessOk),
        },
      },
    }),
    ApiResponse({
      status: 503,
      description: 'The API process is shutting down gracefully.',
      headers: OPERATIONAL_RESPONSE_HEADERS,
      content: {
        [JSON_MEDIA_TYPE]: {
          schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.livenessShuttingDown),
        },
      },
    }),
    internalServerErrorResponse(),
  );
}

export function ApiReadinessOperation(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'healthGetReadiness',
      summary: 'Report whether the API can safely receive application traffic',
    }),
    ApiResponse({
      status: 200,
      description: 'Required synchronous dependencies are available.',
      headers: OPERATIONAL_RESPONSE_HEADERS,
      content: {
        [JSON_MEDIA_TYPE]: {
          schema: openApiSchemaReference(OPENAPI_SCHEMA_NAMES.readinessOk),
        },
      },
    }),
    ApiResponse({
      status: 503,
      description: 'MySQL or Redis is unavailable, or the API is shutting down.',
      headers: OPERATIONAL_RESPONSE_HEADERS,
      content: {
        [JSON_MEDIA_TYPE]: {
          schema: {
            oneOf: [
              openApiSchemaReference(OPENAPI_SCHEMA_NAMES.readinessUnavailable),
              openApiSchemaReference(OPENAPI_SCHEMA_NAMES.readinessShuttingDown),
            ],
          },
        },
      },
    }),
    internalServerErrorResponse(),
  );
}
