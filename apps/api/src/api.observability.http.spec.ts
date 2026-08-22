import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import {
  Controller,
  Get,
  HttpCode,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthCheckService } from '@nestjs/terminus';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { DatabaseConnection } from '@oms/database';
import { Logger, PinoLogger } from 'nestjs-pino';

import { configureApiApplication, createApiExpressAdapter } from './api.application';
import { ApiModule } from './api.module';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INBOUND_REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const INBOUND_CORRELATION_ID = '019ABCDF-1357-7ACE-8BCD-0123456789AB';
const NORMALIZED_CORRELATION_ID = INBOUND_CORRELATION_ID.toLowerCase();
const DATABASE_SECRET = 'mysql://oms_app:readiness-password@private-db.example/oms';
const APPLICATION_SECRET = 'Bearer application-secret-that-must-not-leak';
const DIRECT_ERROR_SECRETS = [
  'plain-error-message-secret',
  'structured-error-property-secret',
  'structured-error-message-secret',
  'error-object-message-secret',
  'arbitrary-message-field-secret',
  'arbitrary-stack-field-secret',
  'arbitrary-cause-field-secret',
  'arbitrary-details-field-secret',
] as const;
const PREEXISTING_PINO_REQUEST_ID = 'earlier-middleware-request-id';
const STRUCTURED_REDACTION_SECRETS = [
  'session-cookie-secret',
  'authorization-header-secret',
  'payment-card-secret',
  'card-cvc-secret',
  'nested-error-message-secret',
  'nested-error-cookie-secret',
] as const;

@Controller('observability-probe')
class ObservabilityProbeController {
  public constructor(private readonly logger: PinoLogger) {
    logger.setContext(ObservabilityProbeController.name);
  }

  @Get('ok')
  public ok(): Readonly<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  @Get('failure')
  public failure(): never {
    throw new Error(APPLICATION_SECRET);
  }

  @Get('context')
  public async context(): Promise<Readonly<{ status: 'ok' }>> {
    await delay(1);
    this.logger.info({ event: 'observability.context.probe' }, 'Request context probe');

    return { status: 'ok' };
  }

  @Get('redaction')
  public redaction(): Readonly<{ status: 'ok' }> {
    const diagnosticError = Object.assign(new Error(STRUCTURED_REDACTION_SECRETS[4]), {
      sessionCookie: STRUCTURED_REDACTION_SECRETS[5],
    });

    this.logger.info(
      {
        Authorization: 'Bearer structured-log-secret',
        authorizationHeader: STRUCTURED_REDACTION_SECRETS[1],
        correlationId: 'caller-controlled-correlation',
        credentials: {
          cardCvc: STRUCTURED_REDACTION_SECRETS[3],
          paymentCard: STRUCTURED_REDACTION_SECRETS[2],
          PaSs_WoRd: 'nested-password-secret',
          refreshTOKEN: 'nested-token-secret',
          sessionCookie: STRUCTURED_REDACTION_SECRETS[0],
          sessions: [{ AccessToken: 'array-token-secret' }],
        },
        diagnosticError,
        event: 'observability.redaction.probe',
        requestId: 'caller-controlled-request',
      },
      'Structured redaction probe',
    );

    return { status: 'ok' };
  }

  @Get('error-calls')
  public errorCalls(): Readonly<{ status: 'ok' }> {
    this.logger.error(DIRECT_ERROR_SECRETS[0]);
    this.logger.error({ error: DIRECT_ERROR_SECRETS[1] }, DIRECT_ERROR_SECRETS[2]);
    this.logger.error(new Error(DIRECT_ERROR_SECRETS[3]));
    this.logger.error({
      cause: DIRECT_ERROR_SECRETS[6],
      details: { reason: DIRECT_ERROR_SECRETS[7] },
      event: 'observability.error.probe',
      message: DIRECT_ERROR_SECRETS[4],
      stack: DIRECT_ERROR_SECRETS[5],
    });

    return { status: 'ok' };
  }

  @Get('rate-limited')
  @HttpCode(429)
  public rateLimited(): Readonly<{ status: 'limited' }> {
    return { status: 'limited' };
  }

  @Get('slow')
  public async slow(): Promise<Readonly<{ status: 'ok' }>> {
    await delay(100);

    return { status: 'ok' };
  }
}

type LogRecord = Readonly<Record<string, unknown>>;

class InMemoryLogStream extends Writable {
  private readonly chunks: string[] = [];

  public clear(): void {
    this.chunks.length = 0;
  }

  public serialized(): string {
    return this.chunks.join('');
  }

  public records(): readonly LogRecord[] {
    return this.serialized()
      .split('\n')
      .filter((line): boolean => line.length > 0)
      .map((line): LogRecord => {
        const parsed = JSON.parse(line) as unknown;

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new TypeError('Expected every structured log line to contain a JSON object');
        }

        return parsed as LogRecord;
      });
  }

  public override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }
}

interface RunningApi {
  readonly application: INestApplication;
  readonly baseUrl: string;
  readonly logs: InMemoryLogStream;
}

interface HealthCheckServiceOverride {
  readonly check: (healthIndicators: readonly unknown[]) => Promise<never>;
}

interface StartApiOptions {
  readonly healthCheckService?: HealthCheckServiceOverride;
  readonly preexistingRequestId?: string;
}

function databaseConnection(probe: () => Promise<void>): DatabaseConnection {
  return {
    close: jest.fn((): Promise<void> => Promise.resolve()),
    probe: jest.fn(probe),
  };
}

async function startApi(
  probe: () => Promise<void>,
  options: StartApiOptions = {},
): Promise<RunningApi> {
  const logs = new InMemoryLogStream();
  const database = databaseConnection(probe);
  let moduleBuilder: TestingModuleBuilder = Test.createTestingModule({
    imports: [
      ApiModule.register({
        createDatabaseConnection: (): DatabaseConnection => database,
        observability: {
          deploymentEnvironment: 'test',
          level: 'info',
          stream: logs,
        },
      }),
    ],
    controllers: [ObservabilityProbeController],
  });

  if (options.healthCheckService !== undefined) {
    moduleBuilder = moduleBuilder
      .overrideProvider(HealthCheckService)
      .useValue(options.healthCheckService);
  }

  const moduleReference = await moduleBuilder.compile();
  const application = moduleReference.createNestApplication<NestExpressApplication>(
    createApiExpressAdapter(),
    {
      bodyParser: false,
      bufferLogs: true,
    },
  );
  const preexistingRequestId = options.preexistingRequestId;

  if (preexistingRequestId !== undefined) {
    application.use(
      (request: IncomingMessage, _response: ServerResponse, next: () => void): void => {
        request.id = preexistingRequestId;
        next();
      },
    );
  }

  application.useLogger(application.get(Logger));
  configureApiApplication(application);
  await application.listen(0, '127.0.0.1');
  logs.clear();

  return {
    application,
    baseUrl: await application.getUrl(),
    logs,
  };
}

async function allowResponseLoggingToComplete(): Promise<void> {
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
}

function expectResponseIdentity(response: Response): Readonly<{
  correlationId: string;
  requestId: string;
}> {
  const requestId = response.headers.get('x-request-id');
  const correlationId = response.headers.get('x-correlation-id');

  expect(requestId).toMatch(UUID_V4);
  expect(correlationId).not.toBeNull();

  if (requestId === null || correlationId === null) {
    throw new Error('Expected request identity response headers');
  }

  return {
    correlationId,
    requestId,
  };
}

function onlyLogRecord(logs: InMemoryLogStream): LogRecord {
  const records = logs.records();

  expect(records).toHaveLength(1);

  const record = records[0];

  if (record === undefined) {
    throw new Error('Expected exactly one structured log record');
  }

  return record;
}

describe('API HTTP observability contract', (): void => {
  it('generates a server-owned request ID and uses it as the default correlation ID', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());

    try {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/observability-probe/ok`, {
        headers: { 'X-Request-Id': INBOUND_REQUEST_ID },
      });
      await allowResponseLoggingToComplete();
      const identity = expectResponseIdentity(response);
      const log = onlyLogRecord(runningApi.logs);

      expect(response.status).toBe(200);
      expect(identity.requestId).not.toBe(INBOUND_REQUEST_ID);
      expect(identity.correlationId).toBe(identity.requestId);
      expect(log).toMatchObject({
        correlationId: identity.correlationId,
        deploymentEnvironment: 'test',
        event: 'http.request.completed',
        http: {
          method: 'GET',
          route: '/api/v1/observability-probe/ok',
          statusCode: 200,
        },
        level: 'info',
        requestId: identity.requestId,
        service: 'oms-api',
      });
      expect(log['time']).toEqual(expect.any(String));
    } finally {
      await runningApi.application.close();
    }
  });

  it('accepts one canonical v4 or v7 correlation ID and normalizes it', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());

    try {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/observability-probe/ok`, {
        headers: { 'X-Correlation-Id': INBOUND_CORRELATION_ID },
      });
      await allowResponseLoggingToComplete();
      const identity = expectResponseIdentity(response);
      const log = onlyLogRecord(runningApi.logs);

      expect(response.status).toBe(200);
      expect(identity.correlationId).toBe(NORMALIZED_CORRELATION_ID);
      expect(identity.requestId).not.toBe(identity.correlationId);
      expect(log).toMatchObject({
        correlationId: NORMALIZED_CORRELATION_ID,
        requestId: identity.requestId,
      });
    } finally {
      await runningApi.application.close();
    }
  });

  it('replaces a request ID populated by earlier middleware', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve(), {
      preexistingRequestId: PREEXISTING_PINO_REQUEST_ID,
    });

    try {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/observability-probe/ok`);
      await allowResponseLoggingToComplete();
      const identity = expectResponseIdentity(response);
      const log = onlyLogRecord(runningApi.logs);

      expect(response.status).toBe(200);
      expect(identity.requestId).not.toBe(PREEXISTING_PINO_REQUEST_ID);
      expect(log).toMatchObject({
        correlationId: identity.requestId,
        requestId: identity.requestId,
      });
      expect(runningApi.logs.serialized()).not.toContain(PREEXISTING_PINO_REQUEST_ID);
    } finally {
      await runningApi.application.close();
    }
  });

  it('logs an unmatched route without recording its path, query, or secrets', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());
    const pathSecret = 'customer-private-reference';
    const querySecret = 'query-password-that-must-not-leak';

    try {
      const response = await fetch(
        `${runningApi.baseUrl}/api/v1/missing/${pathSecret}?password=${querySecret}`,
      );
      await allowResponseLoggingToComplete();
      const log = onlyLogRecord(runningApi.logs);

      expect(response.status).toBe(404);
      expect(log).toMatchObject({
        event: 'http.request.completed',
        http: {
          method: 'GET',
          statusCode: 404,
        },
        level: 'info',
      });
      expect(runningApi.logs.serialized()).not.toContain(pathSecret);
      expect(runningApi.logs.serialized()).not.toContain(querySecret);
      expect(runningApi.logs.serialized()).not.toContain('password=');
    } finally {
      await runningApi.application.close();
    }
  });

  it('adds request identity headers but suppresses successful health access logs', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());

    try {
      const liveResponse = await fetch(`${runningApi.baseUrl}/health/live/`);
      const liveHeadResponse = await fetch(`${runningApi.baseUrl}/health/live/`, {
        method: 'HEAD',
      });
      const readyResponse = await fetch(`${runningApi.baseUrl}/health/ready/?probe=orchestrator`);
      await allowResponseLoggingToComplete();

      expect(liveResponse.status).toBe(200);
      expect(liveHeadResponse.status).toBe(200);
      expect(readyResponse.status).toBe(200);
      expectResponseIdentity(liveResponse);
      expectResponseIdentity(liveHeadResponse);
      expectResponseIdentity(readyResponse);
      expect(runningApi.logs.records()).toEqual([]);
    } finally {
      await runningApi.application.close();
    }
  });

  it('logs failed readiness at warn without leaking database failure details', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> =>
      Promise.reject(new Error(DATABASE_SECRET)),
    );

    try {
      const response = await fetch(`${runningApi.baseUrl}/health/ready/?probe=orchestrator`);
      const rawBody = await response.text();
      await allowResponseLoggingToComplete();
      const identity = expectResponseIdentity(response);
      const log = onlyLogRecord(runningApi.logs);

      expect(response.status).toBe(503);
      expect(log).toMatchObject({
        correlationId: identity.correlationId,
        event: 'http.request.completed',
        http: {
          method: 'GET',
          route: '/health/ready',
          statusCode: 503,
        },
        level: 'warn',
        requestId: identity.requestId,
      });
      expect(rawBody).not.toContain(DATABASE_SECRET);
      expect(runningApi.logs.serialized()).not.toContain(DATABASE_SECRET);
      expect(runningApi.logs.serialized()).not.toContain('readiness-password');
      expect(runningApi.logs.serialized()).not.toContain('private-db.example');
    } finally {
      await runningApi.application.close();
    }
  });

  it('logs planned liveness and readiness shutdown as warnings', async (): Promise<void> => {
    const healthCheckService: HealthCheckServiceOverride = {
      check: (healthIndicators): Promise<never> =>
        Promise.reject(
          new ServiceUnavailableException(
            healthIndicators.length === 0
              ? { status: 'shutting_down', info: {}, error: {}, details: {} }
              : {
                  status: 'shutting_down',
                  info: { database: { status: 'up' } },
                  error: {},
                  details: { database: { status: 'up' } },
                },
          ),
        ),
    };
    const runningApi = await startApi((): Promise<void> => Promise.resolve(), {
      healthCheckService,
    });

    try {
      const liveResponse = await fetch(`${runningApi.baseUrl}/health/live`);
      const readyResponse = await fetch(`${runningApi.baseUrl}/health/ready`);
      await allowResponseLoggingToComplete();
      const records = runningApi.logs.records();

      expect(liveResponse.status).toBe(503);
      expect(readyResponse.status).toBe(503);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        event: 'http.request.completed',
        http: { route: '/health/live', statusCode: 503 },
        level: 'warn',
      });
      expect(records[1]).toMatchObject({
        event: 'http.request.completed',
        http: { route: '/health/ready', statusCode: 503 },
        level: 'warn',
      });
    } finally {
      await runningApi.application.close();
    }
  });

  it('logs an unexpected 500 without exposing exception details', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());

    try {
      const response = await fetch(
        `${runningApi.baseUrl}/api/v1/observability-probe/failure?token=query-secret`,
        {
          headers: {
            Authorization: 'Bearer authorization-secret',
            Cookie: 'session=cookie-secret',
          },
        },
      );
      const rawBody = await response.text();
      await allowResponseLoggingToComplete();
      const identity = expectResponseIdentity(response);
      const logs = runningApi.logs.records();
      const completionLog = logs.find(
        (record): boolean => record['event'] === 'http.request.completed',
      );

      expect(response.status).toBe(500);
      expect(completionLog).toMatchObject({
        correlationId: identity.correlationId,
        event: 'http.request.completed',
        http: {
          method: 'GET',
          route: '/api/v1/observability-probe/failure',
          statusCode: 500,
        },
        level: 'error',
        requestId: identity.requestId,
      });
      expect(rawBody).not.toContain(APPLICATION_SECRET);
      expect(runningApi.logs.serialized()).not.toContain(APPLICATION_SECRET);
      expect(runningApi.logs.serialized()).not.toContain('application-secret-that-must-not-leak');
      expect(runningApi.logs.serialized()).not.toContain('authorization-secret');
      expect(runningApi.logs.serialized()).not.toContain('cookie-secret');
      expect(runningApi.logs.serialized()).not.toContain('query-secret');
    } finally {
      await runningApi.application.close();
    }
  });

  it('keeps request context isolated across concurrent asynchronous work', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());
    const correlations = Array.from(
      { length: 25 },
      (_unused, index): string => `019abcdf-1357-7ace-8bcd-${index.toString(16).padStart(12, '0')}`,
    );

    try {
      const responses = await Promise.all(
        correlations.map((correlationId) =>
          fetch(`${runningApi.baseUrl}/api/v1/observability-probe/context`, {
            headers: { 'X-Correlation-Id': correlationId },
          }),
        ),
      );
      await allowResponseLoggingToComplete();
      const identities = responses.map(expectResponseIdentity);
      const contextLogs = runningApi.logs
        .records()
        .filter((record): boolean => record['event'] === 'observability.context.probe');

      expect(contextLogs).toHaveLength(correlations.length);
      expect(new Set(identities.map(({ requestId }) => requestId)).size).toBe(correlations.length);

      for (const [index, identity] of identities.entries()) {
        expect(responses[index]?.status).toBe(200);
        expect(identity.correlationId).toBe(correlations[index]);
        expect(contextLogs).toContainEqual(
          expect.objectContaining({
            component: ObservabilityProbeController.name,
            correlationId: correlations[index],
            requestId: identity.requestId,
          }),
        );
      }
    } finally {
      await runningApi.application.close();
    }
  });

  it('redacts sensitive structured fields recursively and case-insensitively', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());

    try {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/observability-probe/redaction`);
      await allowResponseLoggingToComplete();
      const identity = expectResponseIdentity(response);
      const serializedLogs = runningApi.logs.serialized();
      const redactionLog = runningApi.logs
        .records()
        .find((record): boolean => record['event'] === 'observability.redaction.probe');

      expect(response.status).toBe(200);
      expect(redactionLog).toMatchObject({
        Authorization: '[REDACTED]',
        authorizationHeader: '[REDACTED]',
        correlationId: identity.correlationId,
        credentials: {
          cardCvc: '[REDACTED]',
          paymentCard: '[REDACTED]',
          PaSs_WoRd: '[REDACTED]',
          refreshTOKEN: '[REDACTED]',
          sessionCookie: '[REDACTED]',
          sessions: [{ AccessToken: '[REDACTED]' }],
        },
        diagnosticError: {
          code: 'UNEXPECTED_ERROR',
          type: 'Error',
        },
        requestId: identity.requestId,
      });
      expect(serializedLogs).not.toContain('structured-log-secret');
      expect(serializedLogs).not.toContain('nested-password-secret');
      expect(serializedLogs).not.toContain('nested-token-secret');
      expect(serializedLogs).not.toContain('array-token-secret');
      expect(serializedLogs).not.toContain('caller-controlled-correlation');
      expect(serializedLogs).not.toContain('caller-controlled-request');

      for (const secret of STRUCTURED_REDACTION_SECRETS) {
        expect(serializedLogs).not.toContain(secret);
      }
    } finally {
      await runningApi.application.close();
    }
  });

  it('uses fixed messages for every error logging call shape', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());

    try {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/observability-probe/error-calls`);
      await allowResponseLoggingToComplete();
      const serializedLogs = runningApi.logs.serialized();
      const errorLogs = runningApi.logs
        .records()
        .filter((record): boolean => record['level'] === 'error');

      expect(response.status).toBe(200);
      expect(errorLogs).toHaveLength(4);

      for (const record of errorLogs) {
        expect(record['msg']).toBe('Unexpected error');
      }

      for (const secret of DIRECT_ERROR_SECRETS) {
        expect(serializedLogs).not.toContain(secret);
      }
    } finally {
      await runningApi.application.close();
    }
  });

  it('classifies rate limiting as a warning', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());

    try {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/observability-probe/rate-limited`);
      await allowResponseLoggingToComplete();

      expect(response.status).toBe(429);
      expect(onlyLogRecord(runningApi.logs)).toMatchObject({
        event: 'http.request.completed',
        http: {
          route: '/api/v1/observability-probe/rate-limited',
          statusCode: 429,
        },
        level: 'warn',
      });
    } finally {
      await runningApi.application.close();
    }
  });

  it('emits one warning when the client aborts a request', async (): Promise<void> => {
    const runningApi = await startApi((): Promise<void> => Promise.resolve());
    const controller = new AbortController();

    try {
      const request = fetch(`${runningApi.baseUrl}/api/v1/observability-probe/slow`, {
        signal: controller.signal,
      });

      await delay(10);
      controller.abort();

      await expect(request).rejects.toHaveProperty('name', 'AbortError');
      await delay(120);

      const abortLogs = runningApi.logs
        .records()
        .filter((record): boolean => record['event'] === 'http.request.aborted');

      expect(abortLogs).toHaveLength(1);
      expect(abortLogs[0]).toMatchObject({
        http: {
          route: '/api/v1/observability-probe/slow',
        },
        level: 'warn',
      });
    } finally {
      await runningApi.application.close();
    }
  });
});
