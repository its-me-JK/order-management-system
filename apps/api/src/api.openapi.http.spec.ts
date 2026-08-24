import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { DatabaseConnection } from '@oms/database';

import { createDatabaseRuntimeFixture } from '../test-support/database-runtime.fixture';
import { createRedisRuntimeFixture } from '../test-support/redis-runtime.fixture';
import { configureApiApplication, createApiExpressAdapter } from './api.application';
import { assertValidOperationIds } from './api.documentation';
import { ApiModule } from './api.module';
import { OPENAPI_SCHEMA_NAMES } from './platform/openapi/openapi.schemas';

type HttpMethod = 'get' | 'patch' | 'post';
type Security = 'bearer' | 'cookie' | 'public';

interface ExpectedOperation {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly security: Security;
}

const EXPECTED_OPERATIONS: readonly ExpectedOperation[] = [
  { id: 'healthGetLiveness', method: 'get', path: '/health/live', security: 'public' },
  { id: 'healthGetReadiness', method: 'get', path: '/health/ready', security: 'public' },
  { id: 'registerUser', method: 'post', path: '/api/v1/auth/register', security: 'public' },
  { id: 'loginUser', method: 'post', path: '/api/v1/auth/login', security: 'public' },
  {
    id: 'refreshUserSession',
    method: 'post',
    path: '/api/v1/auth/refresh',
    security: 'cookie',
  },
  { id: 'logoutUser', method: 'post', path: '/api/v1/auth/logout', security: 'cookie' },
  { id: 'getCurrentUser', method: 'get', path: '/api/v1/auth/me', security: 'bearer' },
  {
    id: 'listCatalogProducts',
    method: 'get',
    path: '/api/v1/catalog/products',
    security: 'public',
  },
  {
    id: 'listCatalogSkus',
    method: 'get',
    path: '/api/v1/catalog/skus',
    security: 'public',
  },
  {
    id: 'getCatalogSku',
    method: 'get',
    path: '/api/v1/catalog/skus/{id}',
    security: 'public',
  },
  {
    id: 'createCatalogProduct',
    method: 'post',
    path: '/api/v1/admin/products',
    security: 'bearer',
  },
  {
    id: 'updateCatalogProduct',
    method: 'patch',
    path: '/api/v1/admin/products/{id}',
    security: 'bearer',
  },
  {
    id: 'createCatalogSku',
    method: 'post',
    path: '/api/v1/admin/products/{productId}/skus',
    security: 'bearer',
  },
  {
    id: 'updateCatalogSku',
    method: 'patch',
    path: '/api/v1/admin/skus/{id}',
    security: 'bearer',
  },
  {
    id: 'listInventory',
    method: 'get',
    path: '/api/v1/inventory',
    security: 'bearer',
  },
  {
    id: 'getInventoryBySku',
    method: 'get',
    path: '/api/v1/inventory/{skuId}',
    security: 'public',
  },
  {
    id: 'adjustInventory',
    method: 'post',
    path: '/api/v1/inventory/{skuId}/adjust',
    security: 'bearer',
  },
  { id: 'createOrder', method: 'post', path: '/api/v1/orders', security: 'bearer' },
  { id: 'listOrders', method: 'get', path: '/api/v1/orders', security: 'bearer' },
  {
    id: 'getOrder',
    method: 'get',
    path: '/api/v1/orders/{orderId}',
    security: 'bearer',
  },
  {
    id: 'cancelOrder',
    method: 'post',
    path: '/api/v1/orders/{orderId}/cancel',
    security: 'bearer',
  },
  {
    id: 'getOrderPayment',
    method: 'get',
    path: '/api/v1/orders/{orderId}/payment',
    security: 'bearer',
  },
  {
    id: 'shipOrder',
    method: 'post',
    path: '/api/v1/admin/orders/{orderId}/ship',
    security: 'bearer',
  },
  {
    id: 'deliverOrder',
    method: 'post',
    path: '/api/v1/admin/orders/{orderId}/deliver',
    security: 'bearer',
  },
  {
    id: 'refundPayment',
    method: 'post',
    path: '/api/v1/payments/{paymentId}/refund',
    security: 'bearer',
  },
  {
    id: 'listNotifications',
    method: 'get',
    path: '/api/v1/notifications',
    security: 'bearer',
  },
  {
    id: 'markNotificationRead',
    method: 'patch',
    path: '/api/v1/notifications/{notificationId}/read',
    security: 'bearer',
  },
];

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
        createDatabaseRuntime: () => createDatabaseRuntimeFixture(databaseConnection(probe)),
        createRedisRuntime: createRedisRuntimeFixture,
        observability: { deploymentEnvironment: 'test', level: 'silent' },
      }),
    ],
  }).compile();
  const application = moduleReference.createNestApplication<NestExpressApplication>(
    createApiExpressAdapter(),
    { bodyParser: false, logger: false },
  );

  configureApiApplication(application);
  await application.listen(0, '127.0.0.1');

  return { application, baseUrl: await application.getUrl(), probe };
}

function operation(document: OpenAPIObject, expected: ExpectedOperation): OperationObject {
  const pathItem = document.paths[expected.path];
  const value = pathItem?.[expected.method];

  if (value === undefined) throw new Error(`Missing ${expected.method} ${expected.path}`);
  return value;
}

function concreteSchema(value: ReferenceObject | SchemaObject | undefined): SchemaObject {
  if (value === undefined || '$ref' in value) throw new Error('Expected a concrete schema');
  return value;
}

function concreteParameter(value: ReferenceObject | ParameterObject): ParameterObject {
  if ('$ref' in value) throw new Error('Expected a concrete parameter');
  return value;
}

function documentWithOperationIds(
  document: OpenAPIObject,
  operationIds: readonly (string | undefined)[],
): OpenAPIObject {
  return {
    ...document,
    paths: Object.fromEntries(
      operationIds.map((operationId, index) => [
        `/probe-${String(index)}`,
        { get: { ...(operationId === undefined ? {} : { operationId }), responses: {} } },
      ]),
    ),
  };
}

describe('API OpenAPI contract', (): void => {
  let runningApi: RunningApi;
  let document: OpenAPIObject;

  beforeAll(async (): Promise<void> => {
    runningApi = await startApi();
    const response = await fetch(`${runningApi.baseUrl}/docs/openapi.json`);
    document = (await response.json()) as OpenAPIObject;
  });

  afterAll(async (): Promise<void> => {
    await runningApi.application.close();
  });

  it('publishes every implemented operation with a stable unique ID', (): void => {
    const actual = Object.entries(document.paths).flatMap(([path, pathItem]) =>
      (['get', 'patch', 'post'] as const).flatMap((method) =>
        pathItem?.[method] === undefined ? [] : [`${method} ${path}`],
      ),
    );
    const expected = EXPECTED_OPERATIONS.map(({ method, path }) => `${method} ${path}`);

    expect(actual.sort()).toEqual(expected.sort());
    expect((): void => assertValidOperationIds(document)).not.toThrow();

    for (const expectedOperation of EXPECTED_OPERATIONS) {
      expect(operation(document, expectedOperation).operationId).toBe(expectedOperation.id);
    }

    expect(runningApi.probe).not.toHaveBeenCalled();
  });

  it('documents public, bearer, and refresh-cookie security accurately', (): void => {
    expect(document.components?.securitySchemes?.['access-token']).toMatchObject({
      scheme: 'bearer',
      type: 'http',
    });
    expect(document.components?.securitySchemes?.['refresh-token']).toMatchObject({
      in: 'cookie',
      name: 'oms_refresh',
      type: 'apiKey',
    });

    for (const expected of EXPECTED_OPERATIONS) {
      const security = operation(document, expected).security ?? [];
      const securityName = expected.security === 'bearer' ? 'access-token' : 'refresh-token';

      expect(security).toEqual(expected.security === 'public' ? [] : [{ [securityName]: [] }]);
    }
  });

  it('documents validated request fields and idempotent order creation', (): void => {
    const schemas = document.components?.schemas;
    const login = concreteSchema(schemas?.['LoginDto']);
    const createOrder = concreteSchema(schemas?.['CreateOrderDto']);
    const shippingAddress = concreteSchema(schemas?.['ShippingAddressDto']);
    const expectedCreateOrder = EXPECTED_OPERATIONS.find(({ id }) => id === 'createOrder');

    if (expectedCreateOrder === undefined) throw new Error('Missing expected createOrder contract');

    const createOrderOperation = operation(document, expectedCreateOrder);
    const idempotencyHeader = (createOrderOperation.parameters ?? [])
      .map(concreteParameter)
      .find(({ name }) => name === 'Idempotency-Key');

    expect(login.required).toEqual(expect.arrayContaining(['email', 'password']));
    expect(login.properties?.['email']).toMatchObject({ format: 'email', type: 'string' });
    expect(createOrder.required).toEqual(expect.arrayContaining(['items', 'shippingAddress']));
    expect(shippingAddress.properties?.['country']).toMatchObject({
      maxLength: 2,
      minLength: 2,
      pattern: '^[A-Z]{2}$',
    });
    expect(idempotencyHeader).toMatchObject({ in: 'header', required: true });
  });

  it('documents Redis and MySQL readiness plus sanitized 401 responses', (): void => {
    const dependencySchema = concreteSchema(
      document.components?.schemas?.[OPENAPI_SCHEMA_NAMES.healthDependenciesUp],
    );
    const problemSchema = concreteSchema(
      document.components?.schemas?.[OPENAPI_SCHEMA_NAMES.problemDetails],
    );
    const statusSchema = concreteSchema(problemSchema.properties?.['status']);

    expect(dependencySchema.required).toEqual(['database', 'redis']);
    expect(statusSchema.enum).toEqual(expect.arrayContaining([401, 403, 409, 429]));
    expect(document.paths['/health/ready']?.get?.responses['503']).toBeDefined();
  });

  it('rejects missing, generated, malformed, and duplicate operation IDs', (): void => {
    for (const operationIds of [
      [undefined],
      ['UNSPECIFIED_OrdersController_create_v1'],
      ['OrdersCreate'],
      ['orders-create'],
      ['ordersCreate', 'ordersCreate'],
    ] as const) {
      expect((): void =>
        assertValidOperationIds(documentWithOperationIds(document, operationIds)),
      ).toThrow('The generated OpenAPI document has invalid operation identifiers');
    }
  });

  it('serves only the intended local Swagger resources', async (): Promise<void> => {
    const htmlResponse = await fetch(`${runningApi.baseUrl}/docs`);
    const html = await htmlResponse.text();

    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('<title>OMS API Documentation</title>');

    for (const path of ['/api/docs', '/docs/openapi.yaml', '/docs/package.json', '/docs-json']) {
      expect((await fetch(`${runningApi.baseUrl}${path}`)).status).toBe(404);
    }
  });
});
