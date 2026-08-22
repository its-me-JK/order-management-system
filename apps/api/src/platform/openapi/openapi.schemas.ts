import type { HeaderObject, ReferenceObject, SchemaObject } from '@nestjs/swagger';

import { OPERATIONAL_HEALTH_CACHE_CONTROL } from '../health/operational-health-response';
import { PROBLEM_DETAILS_CACHE_CONTROL } from '../http-errors/problem-details.contract';
import {
  internalServerErrorDescriptor,
  type ProblemDescriptor,
  problemDescriptorForStatus,
  SUPPORTED_PROBLEM_STATUSES,
} from '../http-errors/problem-descriptors';

export const OPENAPI_SCHEMA_NAMES = Object.freeze({
  badRequestProblem: 'BadRequestProblem',
  healthDatabaseDownComponents: 'OperationalHealthDatabaseDownComponents',
  healthDatabaseUpComponents: 'OperationalHealthDatabaseUpComponents',
  healthEmptyComponents: 'OperationalHealthEmptyComponents',
  internalServerErrorProblem: 'InternalServerErrorProblem',
  livenessOk: 'OperationalHealthLivenessOk',
  livenessShuttingDown: 'OperationalHealthLivenessShuttingDown',
  problemDetails: 'ProblemDetails',
  readinessOk: 'OperationalHealthReadinessOk',
  readinessShuttingDownAvailable: 'OperationalHealthReadinessShuttingDownAvailable',
  readinessShuttingDownUnavailable: 'OperationalHealthReadinessShuttingDownUnavailable',
  readinessUnavailable: 'OperationalHealthReadinessUnavailable',
  notFoundProblem: 'NotFoundProblem',
  serviceUnavailableProblem: 'ServiceUnavailableProblem',
});

export const OPENAPI_HEADER_NAMES = Object.freeze({
  correlationId: 'CorrelationId',
  operationalHealthCacheControl: 'OperationalHealthCacheControl',
  problemCacheControl: 'ProblemCacheControl',
  publicReadCacheControl: 'PublicReadCacheControl',
  requestId: 'RequestId',
});

type OpenApiSchemaName = (typeof OPENAPI_SCHEMA_NAMES)[keyof typeof OPENAPI_SCHEMA_NAMES];
type OpenApiHeaderName = (typeof OPENAPI_HEADER_NAMES)[keyof typeof OPENAPI_HEADER_NAMES];

const UUID_V4_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UUID_V4_OR_V7_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const PUBLIC_READ_CACHE_CONTROL = 'no-store';

export function openApiSchemaReference(name: OpenApiSchemaName): ReferenceObject {
  return { $ref: `#/components/schemas/${name}` };
}

export function openApiHeaderReference(name: OpenApiHeaderName): ReferenceObject {
  return { $ref: `#/components/headers/${name}` };
}

function componentStatusSchema(status: 'down' | 'up'): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: [status] },
    },
    required: ['status'],
  };
}

function databaseComponentsSchema(status: 'down' | 'up'): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      database: componentStatusSchema(status),
    },
    required: ['database'],
  };
}

function healthEnvelopeSchema(
  status: 'error' | 'ok' | 'shutting_down',
  info: ReferenceObject,
  error: ReferenceObject,
  details: ReferenceObject,
): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: [status] },
      info,
      error,
      details,
    },
    required: ['status', 'info', 'error', 'details'],
  };
}

function requiredProblemDescriptor(status: number): ProblemDescriptor {
  const descriptor = problemDescriptorForStatus(status);

  if (descriptor === undefined) {
    throw new Error(`Missing supported Problem Details status ${String(status)}`);
  }

  return descriptor;
}

function statusProblemSchema(descriptor: ProblemDescriptor): SchemaObject {
  return {
    allOf: [
      openApiSchemaReference(OPENAPI_SCHEMA_NAMES.problemDetails),
      {
        type: 'object',
        properties: {
          title: { type: 'string', enum: [descriptor.title] },
          status: { type: 'integer', enum: [descriptor.status] },
          detail: { type: 'string', enum: [descriptor.detail] },
        },
      },
    ],
  };
}

const emptyComponents = openApiSchemaReference(OPENAPI_SCHEMA_NAMES.healthEmptyComponents);
const databaseUpComponents = openApiSchemaReference(
  OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents,
);
const databaseDownComponents = openApiSchemaReference(
  OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents,
);
const internalServerError = internalServerErrorDescriptor();
const badRequest = requiredProblemDescriptor(400);
const notFound = requiredProblemDescriptor(404);
const serviceUnavailable = requiredProblemDescriptor(503);

export const OPENAPI_SCHEMAS: Readonly<Record<string, SchemaObject>> = Object.freeze({
  [OPENAPI_SCHEMA_NAMES.problemDetails]: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['about:blank'] },
      title: { type: 'string', minLength: 1 },
      status: { type: 'integer', enum: [...SUPPORTED_PROBLEM_STATUSES] },
      detail: { type: 'string', minLength: 1 },
      instance: {
        type: 'string',
        format: 'uri',
        pattern: `^urn:uuid:${UUID_V4_PATTERN.slice(1, -1)}$`,
      },
      requestId: { type: 'string', format: 'uuid', pattern: UUID_V4_PATTERN },
      correlationId: { type: 'string', format: 'uuid', pattern: UUID_V4_OR_V7_PATTERN },
    },
    required: ['type', 'title', 'status', 'detail', 'instance', 'requestId', 'correlationId'],
  },
  [OPENAPI_SCHEMA_NAMES.badRequestProblem]: statusProblemSchema(badRequest),
  [OPENAPI_SCHEMA_NAMES.internalServerErrorProblem]: statusProblemSchema(internalServerError),
  [OPENAPI_SCHEMA_NAMES.notFoundProblem]: statusProblemSchema(notFound),
  [OPENAPI_SCHEMA_NAMES.serviceUnavailableProblem]: statusProblemSchema(serviceUnavailable),
  [OPENAPI_SCHEMA_NAMES.healthEmptyComponents]: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  [OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents]: databaseComponentsSchema('up'),
  [OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents]: databaseComponentsSchema('down'),
  [OPENAPI_SCHEMA_NAMES.livenessOk]: healthEnvelopeSchema(
    'ok',
    emptyComponents,
    emptyComponents,
    emptyComponents,
  ),
  [OPENAPI_SCHEMA_NAMES.livenessShuttingDown]: healthEnvelopeSchema(
    'shutting_down',
    emptyComponents,
    emptyComponents,
    emptyComponents,
  ),
  [OPENAPI_SCHEMA_NAMES.readinessOk]: healthEnvelopeSchema(
    'ok',
    databaseUpComponents,
    emptyComponents,
    databaseUpComponents,
  ),
  [OPENAPI_SCHEMA_NAMES.readinessUnavailable]: healthEnvelopeSchema(
    'error',
    emptyComponents,
    databaseDownComponents,
    databaseDownComponents,
  ),
  [OPENAPI_SCHEMA_NAMES.readinessShuttingDownAvailable]: healthEnvelopeSchema(
    'shutting_down',
    databaseUpComponents,
    emptyComponents,
    databaseUpComponents,
  ),
  [OPENAPI_SCHEMA_NAMES.readinessShuttingDownUnavailable]: healthEnvelopeSchema(
    'shutting_down',
    emptyComponents,
    databaseDownComponents,
    databaseDownComponents,
  ),
});

export const OPENAPI_HEADERS: Readonly<Record<string, HeaderObject>> = Object.freeze({
  [OPENAPI_HEADER_NAMES.requestId]: {
    description: 'Server-owned identity for this HTTP request.',
    required: true,
    schema: { type: 'string', format: 'uuid', pattern: UUID_V4_PATTERN },
  },
  [OPENAPI_HEADER_NAMES.correlationId]: {
    description: 'Validated workflow correlation identity or request-ID fallback.',
    required: true,
    schema: { type: 'string', format: 'uuid', pattern: UUID_V4_OR_V7_PATTERN },
  },
  [OPENAPI_HEADER_NAMES.operationalHealthCacheControl]: {
    description: 'Operational health responses are never cached.',
    required: true,
    schema: { type: 'string', enum: [OPERATIONAL_HEALTH_CACHE_CONTROL] },
  },
  [OPENAPI_HEADER_NAMES.problemCacheControl]: {
    description: 'Occurrence-specific Problem Details responses are never cached.',
    required: true,
    schema: { type: 'string', enum: [PROBLEM_DETAILS_CACHE_CONTROL] },
  },
  [OPENAPI_HEADER_NAMES.publicReadCacheControl]: {
    description: 'Public Catalog reads are not cached until a freshness policy exists.',
    required: true,
    schema: { type: 'string', enum: [PUBLIC_READ_CACHE_CONTROL] },
  },
});
