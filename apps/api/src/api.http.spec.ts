import { Controller, Get, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import type { DatabaseConnection } from '@oms/database';

import { configureApiApplication } from './api.application';
import { ApiModule } from './api.module';

const LIVE_RESPONSE = {
  status: 'ok',
  info: {},
  error: {},
  details: {},
} as const;

const READY_RESPONSE = {
  status: 'ok',
  info: {
    database: { status: 'up' },
  },
  error: {},
  details: {
    database: { status: 'up' },
  },
} as const;

const UNAVAILABLE_RESPONSE = {
  status: 'error',
  info: {},
  error: {
    database: { status: 'down' },
  },
  details: {
    database: { status: 'down' },
  },
} as const;

const EXPECTED_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

@Controller('routing-probe')
class RoutingProbeController {
  @Get()
  public get(): Readonly<{ version: '1' }> {
    return { version: '1' };
  }
}

interface RunningApi {
  readonly application: INestApplication;
  readonly baseUrl: string;
}

interface HttpResult {
  readonly body: unknown;
  readonly rawBody: string;
  readonly response: Response;
}

interface FakeDatabase {
  readonly connection: DatabaseConnection;
  readonly probe: jest.MockedFunction<() => Promise<void>>;
}

function createFakeDatabase(probeImplementation: () => Promise<void>): FakeDatabase {
  const probe = jest.fn(probeImplementation);

  return {
    connection: {
      close: jest.fn((): Promise<void> => Promise.resolve()),
      probe,
    },
    probe,
  };
}

async function startApi(database: DatabaseConnection): Promise<RunningApi> {
  const moduleReference = await Test.createTestingModule({
    imports: [
      ApiModule.register({
        createDatabaseConnection: (): DatabaseConnection => database,
      }),
    ],
    controllers: [RoutingProbeController],
  }).compile();
  const application = moduleReference.createNestApplication<NestExpressApplication>({
    logger: false,
  });

  configureApiApplication(application);
  await application.listen(0, '127.0.0.1');

  return {
    application,
    baseUrl: await application.getUrl(),
  };
}

async function getJson(baseUrl: string, path: string): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`);
  const rawBody = await response.text();

  return {
    body: JSON.parse(rawBody) as unknown,
    rawBody,
    response,
  };
}

describe('API operational health', (): void => {
  it('reports liveness without touching a dependency', async (): Promise<void> => {
    const database = createFakeDatabase(() => new Promise<void>(() => undefined));
    const runningApi = await startApi(database.connection);

    try {
      const result = await getJson(runningApi.baseUrl, '/health/live');

      expect(result.response.status).toBe(200);
      expect(result.response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
      expect(result.response.headers.get('x-powered-by')).toBeNull();
      expect(result.body).toEqual(LIVE_RESPONSE);
      expect(database.probe).not.toHaveBeenCalled();
    } finally {
      await runningApi.application.close();
    }
  });

  it('reports readiness after a successful database probe', async (): Promise<void> => {
    const database = createFakeDatabase((): Promise<void> => Promise.resolve());
    const runningApi = await startApi(database.connection);

    try {
      const result = await getJson(runningApi.baseUrl, '/health/ready');

      expect(result.response.status).toBe(200);
      expect(result.response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
      expect(result.body).toEqual(READY_RESPONSE);
      expect(database.probe).toHaveBeenCalledTimes(1);
    } finally {
      await runningApi.application.close();
    }
  });

  it('returns a sanitized unavailable response for every database failure', async (): Promise<void> => {
    const sensitiveDetails = 'mysql://oms_app:do-not-leak@private-db.example/oms with driver stack';
    const database = createFakeDatabase((): Promise<void> =>
      Promise.reject(new Error(sensitiveDetails)),
    );
    const runningApi = await startApi(database.connection);

    try {
      const result = await getJson(runningApi.baseUrl, '/health/ready');

      expect(result.response.status).toBe(503);
      expect(result.response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
      expect(result.body).toEqual(UNAVAILABLE_RESPONSE);
      expect(result.rawBody).not.toContain(sensitiveDetails);
      expect(result.rawBody).not.toContain('do-not-leak');
      expect(result.rawBody).not.toContain('private-db.example');
      expect(result.rawBody).not.toContain('stack');
    } finally {
      await runningApi.application.close();
    }
  });

  it('keeps health unversioned and applies v1 to public API routes', async (): Promise<void> => {
    const database = createFakeDatabase((): Promise<void> => Promise.resolve());
    const runningApi = await startApi(database.connection);

    try {
      const expectedRoutes = [
        ['/health/live', 200],
        ['/api/v1/routing-probe', 200],
      ] as const;
      const absentAliases = [
        '/api/health/live',
        '/api/v1/health/live',
        '/v1/health/live',
        '/routing-probe',
        '/api/routing-probe',
        '/api/v2/routing-probe',
      ] as const;

      for (const [path, status] of expectedRoutes) {
        expect((await fetch(`${runningApi.baseUrl}${path}`)).status).toBe(status);
      }

      for (const path of absentAliases) {
        expect((await fetch(`${runningApi.baseUrl}${path}`)).status).toBe(404);
      }
    } finally {
      await runningApi.application.close();
    }
  });
});
