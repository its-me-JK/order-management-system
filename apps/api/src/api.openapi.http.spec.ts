import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OpenAPIObject, ReferenceObject, ResponseObject, SchemaObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { DatabaseConnection } from '@oms/database';

import { configureApiApplication, createApiExpressAdapter } from './api.application';
import { assertValidOperationIds } from './api.documentation';
import { ApiModule } from './api.module';
import { OPENAPI_HEADER_NAMES, OPENAPI_SCHEMA_NAMES } from './platform/openapi/openapi.schemas';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EXPECTED_PATHS = ['/health/live', '/health/ready'] as const;

interface RunningApi {
  readonly application: INestApplication;
  readonly baseUrl: string;
  readonly probe: jest.MockedFunction<() => Promise<void>>;
}

function databaseConnection(probe: jest.MockedFunction<() => Promise<void>>): DatabaseConnection {
  return {
    close: jest.fn((): Promise<void> => Promise.resolve()),
    probe,
  };
}

async function startApi(): Promise<RunningApi> {
  const probe = jest.fn((): Promise<void> => Promise.resolve());
  const moduleReference = await Test.createTestingModule({
    imports: [
      ApiModule.register({
        createDatabaseConnection: (): DatabaseConnection => databaseConnection(probe),
        observability: {
          deploymentEnvironment: 'test',
          level: 'silent',
        },
      }),
    ],
  }).compile();
  const application = moduleReference.createNestApplication<NestExpressApplication>(
    createApiExpressAdapter(),
    {
      bodyParser: false,
      logger: false,
    },
  );

  configureApiApplication(application);
  await application.listen(0, '127.0.0.1');

  return {
    application,
    baseUrl: await application.getUrl(),
    probe,
  };
}

function expectRequestIdentity(response: Response): void {
  const requestId = response.headers.get('x-request-id');

  expect(requestId).toMatch(UUID_V4);
  expect(response.headers.get('x-correlation-id')).toBe(requestId);
}

function concreteSchema(
  schema: ReferenceObject | SchemaObject | undefined,
  name: string,
): SchemaObject {
  if (schema === undefined || '$ref' in schema) {
    throw new Error(`Expected ${name} to be a concrete OpenAPI schema`);
  }

  return schema;
}

function concreteResponse(
  response: ReferenceObject | ResponseObject | undefined,
  name: string,
): ResponseObject {
  if (response === undefined || '$ref' in response) {
    throw new Error(`Expected ${name} to be a concrete OpenAPI response`);
  }

  return response;
}

function documentWithOperationIds(
  document: OpenAPIObject,
  operationIds: readonly (string | undefined)[],
): OpenAPIObject {
  return {
    ...document,
    paths: Object.fromEntries(
      operationIds.map((operationId, index) => [
        `/operation-${String(index)}`,
        {
          get: {
            ...(operationId === undefined ? {} : { operationId }),
            responses: { 200: { description: 'Successful response' } },
          },
        },
      ]),
    ),
  };
}

function expectHealthEnvelopeSchema(
  schema: SchemaObject,
  status: 'error' | 'ok' | 'shutting_down',
  infoSchemaName: string,
  errorSchemaName: string,
  detailsSchemaName: string,
): void {
  expect(schema).toEqual({
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: [status] },
      info: { $ref: `#/components/schemas/${infoSchemaName}` },
      error: { $ref: `#/components/schemas/${errorSchemaName}` },
      details: { $ref: `#/components/schemas/${detailsSchemaName}` },
    },
    required: ['status', 'info', 'error', 'details'],
  });
}

describe('API OpenAPI contract', (): void => {
  let runningApi: RunningApi;

  beforeAll(async (): Promise<void> => {
    runningApi = await startApi();
  });

  afterAll(async (): Promise<void> => {
    await runningApi.application.close();
  });

  it('serves one deterministic JSON contract without probing MySQL', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/docs/openapi.json`);
    const document = (await response.json()) as OpenAPIObject;
    const serialized = JSON.stringify(document);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expectRequestIdentity(response);
    expect(document.openapi).toBe('3.0.3');
    expect(document.info).toMatchObject({
      title: 'Order Management System API',
      version: '1.0.0',
    });
    expect(document.servers).toEqual([]);
    expect(Object.keys(document.paths).sort()).toEqual([...EXPECTED_PATHS].sort());
    expect(document.paths['/health/live']?.get?.operationId).toBe('healthGetLiveness');
    expect(document.paths['/health/ready']?.get?.operationId).toBe('healthGetReadiness');
    expect(serialized).not.toContain('UNSPECIFIED_');
    expect(serialized).not.toContain('DATABASE_');
    expect(serialized).not.toContain('mysql://');
    expect(serialized).not.toContain('127.0.0.1');
    expect(runningApi.probe).not.toHaveBeenCalled();
  });

  it('fails contract validation for generated, malformed, missing, or duplicate operation IDs', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/docs/openapi.json`);
    const document = (await response.json()) as OpenAPIObject;

    expect((): void => {
      assertValidOperationIds(documentWithOperationIds(document, ['ordersCreate']));
    }).not.toThrow();

    for (const operationIds of [
      [undefined],
      ['UNSPECIFIED_OrdersController_create_v1'],
      ['OrdersCreate'],
      ['orders-create'],
      ['ordersCreate', 'ordersCreate'],
    ] as const) {
      expect((): void => {
        assertValidOperationIds(documentWithOperationIds(document, operationIds));
      }).toThrow('The generated OpenAPI document has invalid operation identifiers');
    }
  });

  it('publishes exact reusable Problem Details and operational-health schemas', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/docs/openapi.json`);
    const document = (await response.json()) as OpenAPIObject;
    const problemSchema = concreteSchema(
      document.components?.schemas?.[OPENAPI_SCHEMA_NAMES.problemDetails],
      OPENAPI_SCHEMA_NAMES.problemDetails,
    );

    expect(problemSchema.additionalProperties).toBe(false);
    expect(problemSchema.required).toEqual([
      'type',
      'title',
      'status',
      'detail',
      'instance',
      'requestId',
      'correlationId',
    ]);
    expect(Object.keys(problemSchema.properties ?? {})).toEqual(problemSchema.required);
    expect(problemSchema.properties?.['type']).toMatchObject({ enum: ['about:blank'] });
    expect(problemSchema.properties?.['requestId']).toMatchObject({
      format: 'uuid',
      type: 'string',
    });

    const schemas = document.components?.schemas;
    const emptyComponents = concreteSchema(
      schemas?.[OPENAPI_SCHEMA_NAMES.healthEmptyComponents],
      OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
    );
    const databaseUpComponents = concreteSchema(
      schemas?.[OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents],
      OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents,
    );
    const databaseDownComponents = concreteSchema(
      schemas?.[OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents],
      OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents,
    );

    expect(emptyComponents).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {},
    });
    expect(databaseUpComponents).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        database: {
          type: 'object',
          additionalProperties: false,
          properties: { status: { type: 'string', enum: ['up'] } },
          required: ['status'],
        },
      },
      required: ['database'],
    });
    expect(databaseDownComponents).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        database: {
          type: 'object',
          additionalProperties: false,
          properties: { status: { type: 'string', enum: ['down'] } },
          required: ['status'],
        },
      },
      required: ['database'],
    });

    for (const [schemaName, status, info, error, details] of [
      [
        OPENAPI_SCHEMA_NAMES.livenessOk,
        'ok',
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
      ],
      [
        OPENAPI_SCHEMA_NAMES.livenessShuttingDown,
        'shutting_down',
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
      ],
      [
        OPENAPI_SCHEMA_NAMES.readinessOk,
        'ok',
        OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents,
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents,
      ],
      [
        OPENAPI_SCHEMA_NAMES.readinessUnavailable,
        'error',
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents,
        OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents,
      ],
      [
        OPENAPI_SCHEMA_NAMES.readinessShuttingDownAvailable,
        'shutting_down',
        OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents,
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthDatabaseUpComponents,
      ],
      [
        OPENAPI_SCHEMA_NAMES.readinessShuttingDownUnavailable,
        'shutting_down',
        OPENAPI_SCHEMA_NAMES.healthEmptyComponents,
        OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents,
        OPENAPI_SCHEMA_NAMES.healthDatabaseDownComponents,
      ],
    ] as const) {
      expectHealthEnvelopeSchema(
        concreteSchema(schemas?.[schemaName], schemaName),
        status,
        info,
        error,
        details,
      );
    }

    for (const schemaName of Object.values(OPENAPI_SCHEMA_NAMES).filter((name) =>
      name.startsWith('OperationalHealth'),
    )) {
      expect(document.components?.schemas?.[schemaName]).toBeDefined();
    }

    expect(document.paths['/health/live']?.get?.responses).toMatchObject({
      200: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/OperationalHealthLivenessOk' },
          },
        },
      },
      503: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/OperationalHealthLivenessShuttingDown' },
          },
        },
      },
      500: {
        content: {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/InternalServerErrorProblem' },
          },
        },
      },
    });
    expect(document.paths['/health/ready']?.get?.responses['503']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            oneOf: [
              { $ref: '#/components/schemas/OperationalHealthReadinessUnavailable' },
              {
                $ref: '#/components/schemas/OperationalHealthReadinessShuttingDownAvailable',
              },
              {
                $ref: '#/components/schemas/OperationalHealthReadinessShuttingDownUnavailable',
              },
            ],
          },
        },
      },
    });

    for (const headerName of Object.values(OPENAPI_HEADER_NAMES)) {
      expect(document.components?.headers?.[headerName]).toMatchObject({ required: true });
    }

    for (const path of EXPECTED_PATHS) {
      for (const status of ['200', '503', '500'] as const) {
        const responseObject = concreteResponse(
          document.paths[path]?.get?.responses[status],
          `${path} ${status}`,
        );
        const cacheHeaderName =
          status === '500'
            ? OPENAPI_HEADER_NAMES.problemCacheControl
            : OPENAPI_HEADER_NAMES.operationalHealthCacheControl;

        expect(responseObject.headers).toEqual({
          'Cache-Control': { $ref: `#/components/headers/${cacheHeaderName}` },
          'X-Request-Id': {
            $ref: `#/components/headers/${OPENAPI_HEADER_NAMES.requestId}`,
          },
          'X-Correlation-Id': {
            $ref: `#/components/headers/${OPENAPI_HEADER_NAMES.correlationId}`,
          },
        });
      }
    }
  });

  it('serves a local read-only Swagger UI with request identity', async (): Promise<void> => {
    const [htmlResponse, initializationResponse, ...assetResponses] = await Promise.all([
      fetch(`${runningApi.baseUrl}/docs`),
      fetch(`${runningApi.baseUrl}/docs/swagger-ui-init.js`),
      fetch(`${runningApi.baseUrl}/docs/swagger-ui-bundle.js`),
      fetch(`${runningApi.baseUrl}/docs/swagger-ui-standalone-preset.js`),
      fetch(`${runningApi.baseUrl}/docs/swagger-ui.css`),
      fetch(`${runningApi.baseUrl}/docs/favicon-32x32.png`),
    ]);
    const html = await htmlResponse.text();
    const initialization = await initializationResponse.text();

    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(htmlResponse.headers.get('cache-control')).toBe('no-store');
    expectRequestIdentity(htmlResponse);
    expect(html).toContain('<title>OMS API Documentation</title>');
    for (const assetResponse of assetResponses) {
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get('cache-control')).toBe('no-store');
      expectRequestIdentity(assetResponse);
    }

    expect(assetResponses[0].headers.get('content-type')).toMatch(/javascript/u);
    expect(assetResponses[1].headers.get('content-type')).toMatch(/javascript/u);
    expect(assetResponses[2].headers.get('content-type')).toMatch(/text\/css/u);
    expect(assetResponses[3].headers.get('content-type')).toMatch(/image\/png/u);
    expect(initializationResponse.status).toBe(200);
    expect(initializationResponse.headers.get('cache-control')).toBe('no-store');
    expect(initializationResponse.headers.get('content-type')).toMatch(/javascript/u);
    expectRequestIdentity(initializationResponse);
    expect(initialization).toMatch(/"supportedSubmitMethods":\s*\[\]/u);
    expect(initialization).toMatch(/"persistAuthorization":\s*false/u);
    expect(initialization).toMatch(/"validatorUrl":\s*null/u);
    expect(runningApi.probe).not.toHaveBeenCalled();
  });

  it.each([
    '/api/docs',
    '/api/v1/docs',
    '/api/v1/docs/openapi.json',
    '/DoCs',
    '/DOCS/openapi.json',
    '/docs/LICENSE',
    '/docs/NOTICE',
    '/docs/README.md',
    '/docs/oauth2-redirect.html',
    '/docs/package.json',
    '/docs/swagger-initializer.js',
    '/docs/swagger-ui-bundle.js.map',
    '/docs-json',
    '/docs-yaml',
    '/docs/openapi.yaml',
  ] as const)('keeps the undocumented alias %s closed', async (path): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}${path}`);
    const rawBody = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
    expect(JSON.parse(rawBody) as unknown).toMatchObject({ type: 'about:blank', status: 404 });
  });
});
