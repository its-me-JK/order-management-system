import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  Controller,
  Get,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthCheckService } from '@nestjs/terminus';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';

import type { DatabaseConnection } from '@oms/database';

import { configureApiApplication, createApiExpressAdapter } from './api.application';
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
const OVERWRITTEN_REQUEST_ID = 'health-overwritten-request-id';
const OVERWRITTEN_CORRELATION_ID = 'health-overwritten-correlation-id';

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

interface HealthCheckServiceOverride {
  readonly check: (healthIndicators: readonly unknown[]) => Promise<never>;
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

async function startApi(
  database: DatabaseConnection,
  healthCheckService?: HealthCheckServiceOverride,
  overwriteIdentityHeaders = false,
): Promise<RunningApi> {
  let moduleBuilder: TestingModuleBuilder = Test.createTestingModule({
    imports: [
      ApiModule.register({
        createDatabaseConnection: (): DatabaseConnection => database,
        observability: {
          deploymentEnvironment: 'test',
          level: 'silent',
        },
      }),
    ],
    controllers: [RoutingProbeController],
  });

  if (healthCheckService !== undefined) {
    moduleBuilder = moduleBuilder.overrideProvider(HealthCheckService).useValue(healthCheckService);
  }

  const moduleReference = await moduleBuilder.compile();
  const application = moduleReference.createNestApplication<NestExpressApplication>(
    createApiExpressAdapter(),
    {
      bodyParser: false,
      logger: false,
    },
  );

  configureApiApplication(application);

  if (overwriteIdentityHeaders) {
    application.use(
      (_request: IncomingMessage, response: ServerResponse, next: () => void): void => {
        response.setHeader('X-Request-Id', OVERWRITTEN_REQUEST_ID);
        response.setHeader('X-Correlation-Id', OVERWRITTEN_CORRELATION_ID);
        next();
      },
    );
  }

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
      expect(result.response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(result.response.headers.get('x-request-id')).not.toBeNull();
      expect(result.response.headers.get('x-correlation-id')).not.toBeNull();
      expect(result.body).toEqual(UNAVAILABLE_RESPONSE);
      expect(result.rawBody).not.toContain(sensitiveDetails);
      expect(result.rawBody).not.toContain('do-not-leak');
      expect(result.rawBody).not.toContain('private-db.example');
      expect(result.rawBody).not.toContain('stack');
    } finally {
      await runningApi.application.close();
    }
  });

  it('fails a malformed Terminus exception closed to Problem Details', async (): Promise<void> => {
    const secret = 'private-malformed-health-payload';
    const database = createFakeDatabase((): Promise<void> => Promise.resolve());
    const healthCheckService: HealthCheckServiceOverride = {
      check: (): Promise<never> =>
        Promise.reject(
          new ServiceUnavailableException({
            ...UNAVAILABLE_RESPONSE,
            secret,
          }),
        ),
    };
    const runningApi = await startApi(database.connection, healthCheckService, true);

    try {
      const result = await getJson(runningApi.baseUrl, '/health/ready');

      expect(result.response.status).toBe(500);
      expect(result.response.headers.get('cache-control')).toBe('no-store');
      expect(result.response.headers.get('content-type')).toBe(
        'application/problem+json; charset=utf-8',
      );
      expect(result.response.headers.get('x-request-id')).not.toBe(OVERWRITTEN_REQUEST_ID);
      expect(result.response.headers.get('x-correlation-id')).not.toBe(OVERWRITTEN_CORRELATION_ID);
      expect(result.body).toMatchObject({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'The service could not complete the request.',
      });
      expect(result.rawBody).not.toContain(secret);
      expect(result.rawBody).not.toContain(OVERWRITTEN_REQUEST_ID);
      expect(result.rawBody).not.toContain(OVERWRITTEN_CORRELATION_ID);
    } finally {
      await runningApi.application.close();
    }
  });

  it('preserves canonical operational 503 responses during graceful shutdown', async (): Promise<void> => {
    const database = createFakeDatabase((): Promise<void> => Promise.resolve());
    const liveShutdown = {
      status: 'shutting_down',
      info: {},
      error: {},
      details: {},
    } as const;
    const readyShutdown = {
      status: 'shutting_down',
      info: { database: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' } },
    } as const;
    const healthCheckService: HealthCheckServiceOverride = {
      check: (healthIndicators): Promise<never> =>
        Promise.reject(
          new ServiceUnavailableException(
            healthIndicators.length === 0 ? liveShutdown : readyShutdown,
          ),
        ),
    };
    const runningApi = await startApi(database.connection, healthCheckService);

    try {
      for (const [path, expected] of [
        ['/health/live', liveShutdown],
        ['/health/ready', readyShutdown],
      ] as const) {
        const result = await getJson(runningApi.baseUrl, path);

        expect(result.response.status).toBe(503);
        expect(result.response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
        expect(result.response.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(result.response.headers.get('x-request-id')).not.toBeNull();
        expect(result.response.headers.get('x-correlation-id')).not.toBeNull();
        expect(result.body).toEqual(expected);
      }
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
        '/HEALTH/LIVE',
        '/API/v1/routing-probe',
        '/api/health/live',
        '/api/V1/routing-probe',
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
