import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  CatalogReadPersistenceError,
  CatalogReadUnavailableError,
  GetPublicSku,
  InvalidCatalogCursorTimestampError,
  InvalidCatalogPageSizeError,
  InvalidCatalogSkuIdError,
  ListPublicSkus,
  parseCatalogSkuPageCursor,
  type CatalogReadRepository,
  type PublicSku,
} from '@oms/catalog';
import type { DatabaseConnection } from '@oms/database';

import { configureApiApplication, createApiExpressAdapter } from '../../../../api.application';
import { ApiModule } from '../../../../api.module';
import { createDatabaseRuntimeFixture } from '../../../../platform/database/database-runtime.fixture';
import { encodeCatalogPublicSkuCursor } from './catalog-public-sku-cursor.codec';
import { CatalogPublicSkuController } from './catalog-public-sku.controller';

const SKU_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const PRODUCT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const CURSOR_CREATED_AT = '2026-08-22T12:34:56.123456Z';
const PRIVATE_FAILURE = 'private-catalog-failure';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const PROBLEM_EXPECTATIONS = Object.freeze({
  400: Object.freeze({ detail: 'The request is invalid.', title: 'Bad Request' }),
  404: Object.freeze({
    detail: 'The requested resource was not found.',
    title: 'Not Found',
  }),
  500: Object.freeze({
    detail: 'The service could not complete the request.',
    title: 'Internal Server Error',
  }),
  503: Object.freeze({
    detail: 'The service is temporarily unavailable.',
    title: 'Service Unavailable',
  }),
});

type ExpectedProblemStatus = keyof typeof PROBLEM_EXPECTATIONS;

const PUBLIC_SKU: PublicSku = Object.freeze({
  id: SKU_ID,
  code: 'MILK-1L',
  name: 'Whole milk 1L',
  product: Object.freeze({
    id: PRODUCT_ID,
    name: 'Whole milk',
  }),
});

type GetPublicSkuExecute = GetPublicSku['execute'];
type ListPublicSkusExecute = ListPublicSkus['execute'];

type UseCaseFixture = Readonly<{
  getPublicSku: jest.MockedFunction<GetPublicSkuExecute>;
  listPublicSkus: jest.MockedFunction<ListPublicSkusExecute>;
}>;

interface RunningCatalogApi extends UseCaseFixture {
  readonly application: INestApplication;
  readonly baseUrl: string;
}

function useCaseFixture(): UseCaseFixture {
  return {
    getPublicSku: jest.fn<ReturnType<GetPublicSkuExecute>, Parameters<GetPublicSkuExecute>>(),
    listPublicSkus: jest.fn<ReturnType<ListPublicSkusExecute>, Parameters<ListPublicSkusExecute>>(),
  };
}

function databaseConnection(): DatabaseConnection {
  return {
    close: jest.fn((): Promise<void> => Promise.resolve()),
    probe: jest.fn((): Promise<void> => Promise.resolve()),
  };
}

async function startCatalogApi(): Promise<RunningCatalogApi> {
  const fixture = useCaseFixture();
  const moduleReference = await Test.createTestingModule({
    imports: [
      ApiModule.register({
        createDatabaseRuntime: () => createDatabaseRuntimeFixture(databaseConnection()),
        observability: {
          deploymentEnvironment: 'test',
          level: 'silent',
        },
      }),
    ],
  })
    .overrideProvider(GetPublicSku)
    .useValue({ execute: fixture.getPublicSku })
    .overrideProvider(ListPublicSkus)
    .useValue({ execute: fixture.listPublicSkus })
    .compile();
  const application = moduleReference.createNestApplication<NestExpressApplication>(
    createApiExpressAdapter(),
    { bodyParser: false, logger: false },
  );

  configureApiApplication(application);
  await application.listen(0, '127.0.0.1');

  return {
    application,
    baseUrl: await application.getUrl(),
    ...fixture,
  };
}

async function responseBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

function expectSafeResponseHeaders(response: Response): Readonly<{
  correlationId: string;
  requestId: string;
}> {
  const requestId = response.headers.get('x-request-id');
  const correlationId = response.headers.get('x-correlation-id');

  expect(requestId).toMatch(UUID_V4);
  expect(correlationId).toBe(requestId);
  expect(response.headers.get('etag')).toBeNull();
  expect(response.headers.get('x-powered-by')).toBeNull();

  if (requestId === null || correlationId === null) {
    throw new Error('Expected request identity response headers');
  }

  return { correlationId, requestId };
}

async function expectFixedProblem(
  response: Response,
  status: ExpectedProblemStatus,
): Promise<string> {
  const { correlationId, requestId } = expectSafeResponseHeaders(response);
  const rawBody = await response.text();
  const expected = PROBLEM_EXPECTATIONS[status];

  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
  expect(JSON.parse(rawBody) as unknown).toEqual({
    type: 'about:blank',
    title: expected.title,
    status,
    detail: expected.detail,
    instance: `urn:uuid:${requestId}`,
    requestId,
    correlationId,
  });

  return rawBody;
}

describe('CatalogPublicSkuController HTTP contract', (): void => {
  let api: RunningCatalogApi;

  beforeAll(async (): Promise<void> => {
    api = await startCatalogApi();
  });

  afterAll(async (): Promise<void> => {
    await api.application.close();
  });

  beforeEach((): void => {
    api.getPublicSku.mockReset();
    api.listPublicSkus.mockReset();
  });

  it('returns the exact public resource envelope and disables caching', async (): Promise<void> => {
    api.getPublicSku.mockResolvedValue({ kind: 'found', sku: PUBLIC_SKU });

    const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus/${SKU_ID}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expectSafeResponseHeaders(response);
    await expect(responseBody(response)).resolves.toEqual({ data: PUBLIC_SKU });
    expect(api.getPublicSku).toHaveBeenCalledTimes(1);
    expect(api.getPublicSku).toHaveBeenCalledWith({ skuId: SKU_ID });
    expect(api.listPublicSkus).not.toHaveBeenCalled();
  });

  it('returns an empty collection with the default query contract', async (): Promise<void> => {
    api.listPublicSkus.mockResolvedValue({ items: [], pageInfo: { nextCursor: null } });

    const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expectSafeResponseHeaders(response);
    await expect(responseBody(response)).resolves.toEqual({
      data: [],
      pageInfo: { nextCursor: null },
    });
    expect(api.listPublicSkus).toHaveBeenCalledTimes(1);
    expect(api.listPublicSkus).toHaveBeenCalledWith({ after: null });
    expect(api.getPublicSku).not.toHaveBeenCalled();
  });

  it('strictly decodes list inputs and encodes the next seek cursor', async (): Promise<void> => {
    const cursor = parseCatalogSkuPageCursor({
      createdAt: CURSOR_CREATED_AT,
      id: SKU_ID,
    });
    const encodedCursor = encodeCatalogPublicSkuCursor(cursor);
    api.listPublicSkus.mockResolvedValue({
      items: [PUBLIC_SKU],
      pageInfo: { nextCursor: cursor },
    });

    const response = await fetch(
      `${api.baseUrl}/api/v1/catalog/skus?limit=100&cursor=${encodeURIComponent(encodedCursor)}`,
    );

    expect(response.status).toBe(200);
    expectSafeResponseHeaders(response);
    await expect(responseBody(response)).resolves.toEqual({
      data: [PUBLIC_SKU],
      pageInfo: { nextCursor: encodedCursor },
    });
    expect(api.listPublicSkus).toHaveBeenCalledWith({ after: cursor, limit: 100 });
  });

  it.each([
    [`/api/v1/catalog/skus/${SKU_ID.toUpperCase()}`, 'an uppercase SKU identifier'],
    ['/api/v1/catalog/skus/not-a-uuid', 'a malformed SKU identifier'],
    [`/api/v1/catalog/skus/${SKU_ID.replace('-7def-', '-4def-')}`, 'a non-v7 identifier'],
    [`/api/v1/catalog/skus/${SKU_ID.replace('-8abc-', '-7abc-')}`, 'an invalid UUID variant'],
    [`/api/v1/catalog/skus/%20${SKU_ID}`, 'a whitespace-prefixed identifier'],
    ['/api/v1/catalog/skus?limit=0', 'a zero page size'],
    ['/api/v1/catalog/skus?limit=01', 'a padded page size'],
    ['/api/v1/catalog/skus?limit=%2B1', 'a signed page size'],
    ['/api/v1/catalog/skus?limit=%201', 'a whitespace-prefixed page size'],
    ['/api/v1/catalog/skus?limit=1.0', 'a decimal page size'],
    ['/api/v1/catalog/skus?limit=1e1', 'an exponent page size'],
    ['/api/v1/catalog/skus?limit=101', 'an oversized page size'],
    ['/api/v1/catalog/skus?limit=1&limit=2', 'a repeated page size'],
    ['/api/v1/catalog/skus?limit%5Bnested%5D=1', 'a nested page size'],
    ['/api/v1/catalog/skus?cursor=', 'an empty cursor'],
    ['/api/v1/catalog/skus?cursor=_', 'a malformed cursor payload'],
    ['/api/v1/catalog/skus?cursor=AA&cursor=AA', 'a repeated cursor'],
    ['/api/v1/catalog/skus?cursor%5Bnested%5D=AA', 'a nested cursor'],
    ['/api/v1/catalog/skus?unexpected=private-input', 'an unknown query parameter'],
  ])('rejects %s (%s) before invoking a use case', async (path): Promise<void> => {
    const response = await fetch(`${api.baseUrl}${path}`);
    const rawBody = await expectFixedProblem(response, 400);

    expect(rawBody).not.toContain('private-input');
    expect(api.getPublicSku).not.toHaveBeenCalled();
    expect(api.listPublicSkus).not.toHaveBeenCalled();
  });

  it.each([
    ['/catalog/skus', 'an unprefixed route'],
    ['/api/v2/catalog/skus', 'an unsupported API version'],
    ['/api/v1/Catalog/skus', 'a case-variant feature route'],
  ])('does not expose %s (%s)', async (path): Promise<void> => {
    const response = await fetch(`${api.baseUrl}${path}`);

    await expectFixedProblem(response, 404);
    expect(api.getPublicSku).not.toHaveBeenCalled();
    expect(api.listPublicSkus).not.toHaveBeenCalled();
  });

  it.each([
    new InvalidCatalogSkuIdError(),
    new InvalidCatalogPageSizeError(),
    new InvalidCatalogCursorTimestampError(),
  ])(
    'maps the application input error %s to a fixed 400 response',
    async (error): Promise<void> => {
      api.getPublicSku.mockRejectedValue(error);

      const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus/${SKU_ID}`);
      const rawBody = await expectFixedProblem(response, 400);

      expect(rawBody).not.toContain(error.message);
    },
  );

  it('makes missing and non-public SKUs indistinguishable as 404', async (): Promise<void> => {
    api.getPublicSku.mockResolvedValue({ kind: 'not-found' });

    const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus/${SKU_ID}`);

    await expectFixedProblem(response, 404);
  });

  it('maps classified read unavailability to a fixed 503 response', async (): Promise<void> => {
    api.listPublicSkus.mockRejectedValue(
      new CatalogReadUnavailableError(new Error(PRIVATE_FAILURE)),
    );

    const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus`);
    const rawBody = await expectFixedProblem(response, 503);

    expect(rawBody).not.toContain(PRIVATE_FAILURE);
  });

  it('retains classified read unavailability as the internal 503 cause', async (): Promise<void> => {
    const failure = new CatalogReadUnavailableError(new Error(PRIVATE_FAILURE));
    const repository: CatalogReadRepository = {
      getPublicSkuById: () => Promise.resolve({ kind: 'not-found' }),
      listPublicSkus: () => Promise.reject(failure),
    };
    const controller = new CatalogPublicSkuController(
      new GetPublicSku(repository),
      new ListPublicSkus(repository),
    );

    try {
      await controller.list({});
      throw new Error('Expected the controller to map Catalog read unavailability');
    } catch (error: unknown) {
      if (!(error instanceof ServiceUnavailableException)) {
        throw error;
      }

      expect(error.getStatus()).toBe(503);
      expect(error.cause).toBe(failure);
    }
  });

  it('leaves unexpected persistence failures on the global 500 path', async (): Promise<void> => {
    api.getPublicSku.mockRejectedValue(new CatalogReadPersistenceError(new Error(PRIVATE_FAILURE)));

    const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus/${SKU_ID}`);
    const rawBody = await expectFixedProblem(response, 500);

    expect(rawBody).not.toContain(PRIVATE_FAILURE);
  });

  it('does not reclassify a trusted cursor encoding failure as client input', async (): Promise<void> => {
    api.listPublicSkus.mockResolvedValue({
      items: [PUBLIC_SKU],
      pageInfo: {
        nextCursor: {
          createdAt: '2026-08-22T12:34:56.123Z',
          id: SKU_ID,
        } as unknown as NonNullable<
          Awaited<ReturnType<ListPublicSkusExecute>>['pageInfo']['nextCursor']
        >,
      },
    });

    const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus`);

    await expectFixedProblem(response, 500);
    expect(api.listPublicSkus).toHaveBeenCalledTimes(1);
  });

  it('allow-lists every nested response field before serialization', async (): Promise<void> => {
    const hostileSku = {
      ...PUBLIC_SKU,
      lifecycleState: PRIVATE_FAILURE,
      product: {
        ...PUBLIC_SKU.product,
        internalCost: PRIVATE_FAILURE,
      },
      supplierSecret: PRIVATE_FAILURE,
    } as unknown as PublicSku;
    api.getPublicSku.mockResolvedValue({ kind: 'found', sku: hostileSku });

    const response = await fetch(`${api.baseUrl}/api/v1/catalog/skus/${SKU_ID}`);
    const rawBody = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(rawBody) as unknown).toEqual({ data: PUBLIC_SKU });
    expect(rawBody).not.toContain(PRIVATE_FAILURE);
    expect(rawBody).not.toContain('lifecycleState');
    expect(rawBody).not.toContain('internalCost');
    expect(rawBody).not.toContain('supplierSecret');
  });
});
