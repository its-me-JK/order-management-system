import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseRuntime, type DatabaseConnectionOptions } from '@oms/database';

import { configureApiApplication, createApiExpressAdapter } from '../src/api.application';
import { ApiModule } from '../src/api.module';
import { parseBootstrapConfiguration } from '../src/bootstrap.configuration';
import {
  CATALOG_HTTP_INTEGRATION_FIXTURE,
  cleanupCatalogHttpIntegrationFixture,
  seedCatalogHttpIntegrationFixture,
} from '../src/platform/database/catalog-integration.fixture';

const CATALOG_INTEGRATION_CONFIRMATION_VARIABLE = 'CATALOG_INTEGRATION_CONFIRM_DATABASE';
const CATALOG_INTEGRATION_DATABASE = 'oms_catalog_integration';
const HTTP_SAFETY_TIMEOUT_MILLISECONDS = 5_000;
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;

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
const localEnvironmentFile = resolve(repositoryRoot, '.env');

if (existsSync(localEnvironmentFile)) {
  loadEnvFile(localEnvironmentFile);
}

function configuredCatalogIntegrationDatabase(): DatabaseConnectionOptions {
  const options = parseBootstrapConfiguration(process.env, repositoryRoot).database;
  const confirmedDatabase = process.env[CATALOG_INTEGRATION_CONFIRMATION_VARIABLE];
  const migrationUrl = process.env['DATABASE_MIGRATION_URL']?.trim();

  if (
    options.database !== CATALOG_INTEGRATION_DATABASE ||
    confirmedDatabase !== options.database ||
    !LOOPBACK_DATABASE_HOSTS.has(options.host) ||
    options.tls.enabled ||
    (migrationUrl !== undefined && migrationUrl !== '')
  ) {
    throw new Error(
      'Catalog HTTP integration requires the confirmed dedicated loopback, non-TLS database ' +
        'without an externally supplied migration URL',
    );
  }

  return options;
}

type JsonHttpResult = Readonly<{
  body: unknown;
  rawBody: string;
  response: Response;
}>;

async function getJson(baseUrl: string, path: string): Promise<JsonHttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(HTTP_SAFETY_TIMEOUT_MILLISECONDS),
  });
  const rawBody = await response.text();

  return {
    body: JSON.parse(rawBody) as unknown,
    rawBody,
    response,
  };
}

function expectRequestIdentity(response: Response): Readonly<{
  correlationId: string;
  requestId: string;
}> {
  const requestId = response.headers.get('x-request-id');
  const correlationId = response.headers.get('x-correlation-id');

  assert.match(requestId ?? '', UUID_V4_PATTERN);
  assert.equal(correlationId, requestId);

  if (requestId === null || correlationId === null) {
    throw new Error('Expected request identity response headers');
  }

  return { correlationId, requestId };
}

function expectJsonSuccess(result: JsonHttpResult): void {
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.response.headers.get('etag'), null);
  assert.equal(result.response.headers.get('x-powered-by'), null);
  expectRequestIdentity(result.response);
}

function expectNotFound(result: JsonHttpResult, requestedSkuId: string): void {
  const identity = expectRequestIdentity(result.response);

  assert.equal(result.response.status, 404);
  assert.equal(
    result.response.headers.get('content-type'),
    'application/problem+json; charset=utf-8',
  );
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.response.headers.get('etag'), null);
  assert.equal(result.response.headers.get('x-powered-by'), null);
  assert.deepEqual(result.body, {
    type: 'about:blank',
    title: 'Not Found',
    status: 404,
    detail: 'The requested resource was not found.',
    instance: `urn:uuid:${identity.requestId}`,
    requestId: identity.requestId,
    correlationId: identity.correlationId,
  });
  assert.equal(result.rawBody.includes(requestedSkuId), false);
}

function publicSku(sku: (typeof CATALOG_HTTP_INTEGRATION_FIXTURE.visibleSkus)[number]): unknown {
  return {
    code: sku.code,
    id: sku.id,
    name: sku.name,
    product: {
      id: CATALOG_HTTP_INTEGRATION_FIXTURE.activeProduct.id,
      name: CATALOG_HTTP_INTEGRATION_FIXTURE.activeProduct.name,
    },
  };
}

void test('Catalog HTTP delivery composes through NestJS, Prisma, and isolated MySQL', async (context) => {
  const runtime = createDatabaseRuntime(configuredCatalogIntegrationDatabase());
  let application: NestExpressApplication | undefined;

  try {
    await seedCatalogHttpIntegrationFixture(runtime);
    application = await NestFactory.create<NestExpressApplication>(
      ApiModule.register({
        createDatabaseRuntime: () => runtime,
        observability: {
          deploymentEnvironment: 'test',
          level: 'silent',
        },
      }),
      createApiExpressAdapter(),
      { bodyParser: false, logger: false },
    );
    configureApiApplication(application);
    await application.listen(0, '127.0.0.1');
    const baseUrl = await application.getUrl();
    const fixture = CATALOG_HTTP_INTEGRATION_FIXTURE;
    const firstVisibleSku = fixture.visibleSkus[0];
    const thirdVisibleSku = fixture.visibleSkus[2];

    assert.ok(firstVisibleSku);
    assert.ok(thirdVisibleSku);

    await context.test('returns the exact active public SKU projection', async () => {
      const result = await getJson(baseUrl, `/api/v1/catalog/skus/${firstVisibleSku.id}`);

      expectJsonSuccess(result);
      assert.deepEqual(result.body, { data: publicSku(firstVisibleSku) });
    });

    await context.test('hides every non-public and missing SKU behind the same 404', async () => {
      const hiddenAndMissingIds = [
        fixture.hiddenSkus.draft.id,
        fixture.hiddenSkus.retired.id,
        fixture.hiddenSkus.activeUnderDraftProduct.id,
        fixture.missingSkuId,
      ] as const;

      for (const skuId of hiddenAndMissingIds) {
        const result = await getJson(baseUrl, `/api/v1/catalog/skus/${skuId}`);

        expectNotFound(result, skuId);
      }
    });

    await context.test(
      'traverses the exact active set once across an opaque equal-timestamp cursor',
      async () => {
        const firstPage = await getJson(baseUrl, '/api/v1/catalog/skus?limit=2');

        expectJsonSuccess(firstPage);
        assert.equal(typeof firstPage.body, 'object');
        assert.notEqual(firstPage.body, null);
        assert.equal(Array.isArray(firstPage.body), false);
        assert.deepEqual(Object.keys(firstPage.body as object), ['data', 'pageInfo']);
        assert.deepEqual(
          (firstPage.body as { data?: unknown }).data,
          fixture.visibleSkus.slice(0, 2).map(publicSku),
        );

        const firstPageInfo = (firstPage.body as { pageInfo?: unknown }).pageInfo;

        assert.equal(typeof firstPageInfo, 'object');
        assert.notEqual(firstPageInfo, null);
        assert.equal(Array.isArray(firstPageInfo), false);
        assert.deepEqual(Object.keys(firstPageInfo as object), ['nextCursor']);

        const nextCursor = (firstPageInfo as { nextCursor?: unknown }).nextCursor;

        assert.equal(typeof nextCursor, 'string');
        assert.match(nextCursor as string, OPAQUE_CURSOR_PATTERN);
        assert.ok((nextCursor as string).length <= 256);

        const secondPage = await getJson(
          baseUrl,
          `/api/v1/catalog/skus?limit=2&cursor=${encodeURIComponent(nextCursor as string)}`,
        );

        expectJsonSuccess(secondPage);
        assert.deepEqual(secondPage.body, {
          data: [publicSku(thirdVisibleSku)],
          pageInfo: { nextCursor: null },
        });

        const traversedIds = [
          ...(firstPage.body as { data: readonly { id: string }[] }).data,
          ...(secondPage.body as { data: readonly { id: string }[] }).data,
        ].map(({ id }): string => id);

        for (const hiddenSku of Object.values(fixture.hiddenSkus)) {
          assert.equal(traversedIds.includes(hiddenSku.id), false);
        }

        assert.deepEqual(
          traversedIds,
          fixture.visibleSkus.map(({ id }) => id),
        );
        assert.equal(new Set(traversedIds).size, fixture.visibleSkus.length);
      },
    );
  } finally {
    try {
      await cleanupCatalogHttpIntegrationFixture(runtime);
    } finally {
      if (application === undefined) {
        await runtime.close();
      } else {
        await application.close();
      }
    }
  }
});
