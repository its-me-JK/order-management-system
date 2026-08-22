import { Writable } from 'node:stream';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { DatabaseConnection } from '@oms/database';
import type { Response as ExpressResponse } from 'express';
import { Logger } from 'nestjs-pino';

import {
  API_REQUEST_BODY_LIMIT_BYTES,
  configureApiApplication,
  createApiExpressAdapter,
} from './api.application';
import { ApiModule } from './api.module';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CORRELATION_ID = '019ABCDF-1357-7ACE-8BCD-0123456789AB';
const NORMALIZED_CORRELATION_ID = CORRELATION_ID.toLowerCase();
const RESPONSE_SECRET = 'private-exception-response-secret';
const UNEXPECTED_SECRET = 'private-unexpected-error-secret';
const PARSER_SECRET = 'private-malformed-json-secret';
const OVERWRITTEN_REQUEST_ID = 'controller-overwritten-request-id';
const OVERWRITTEN_CORRELATION_ID = 'controller-overwritten-correlation-id';

@Controller('problem-probe')
class ProblemProbeController {
  @Post('body')
  public body(@Body() body: unknown): Readonly<{ body: unknown }> {
    return { body };
  }

  @Get('bad-request')
  public badRequest(@Res({ passthrough: true }) response: ExpressResponse): never {
    response.setHeader('X-Request-Id', OVERWRITTEN_REQUEST_ID);
    response.setHeader('X-Correlation-Id', OVERWRITTEN_CORRELATION_ID);
    throw new BadRequestException({
      correlationId: 'caller-controlled-correlation',
      detail: RESPONSE_SECRET,
      instance: '/private/internal/path',
      requestId: 'caller-controlled-request',
      status: 599,
      title: RESPONSE_SECRET,
      token: RESPONSE_SECRET,
      type: 'https://attacker.example/problem',
    });
  }

  @Get('unavailable')
  public unavailable(): never {
    throw new ServiceUnavailableException({
      detail: RESPONSE_SECRET,
      dependency: 'private-mysql-host',
    });
  }

  @Get('rate-limited')
  public rateLimited(@Res({ passthrough: true }) response: ExpressResponse): never {
    response.setHeader('Retry-After', '60');
    response.setHeader('RateLimit', 'limit=10, remaining=0, reset=60');
    response.setHeader('X-RateLimit-Remaining', '0');
    response.setHeader('WWW-Authenticate', 'Bearer realm="must-not-survive-429"');
    throw new HttpException(RESPONSE_SECRET, 429);
  }

  @Get('unexpected')
  public unexpected(): never {
    throw Object.assign(new Error(UNEXPECTED_SECRET), {
      cause: new Error('private-cause'),
      statusCode: 401,
      token: 'private-token',
    });
  }

  @Get('unsupported-status')
  public unsupportedStatus(): never {
    throw new HttpException(RESPONSE_SECRET, 418);
  }

  @Get('unauthorized-without-challenge')
  public unauthorizedWithoutChallenge(): never {
    throw new UnauthorizedException(RESPONSE_SECRET);
  }

  @Get('unauthorized')
  public unauthorized(@Res({ passthrough: true }) response: ExpressResponse): never {
    response.setHeader('Content-Disposition', 'attachment; filename="private.txt"');
    response.setHeader('ETag', '"private-etag"');
    response.setHeader('Last-Modified', 'Thu, 01 Jan 1970 00:00:00 GMT');
    response.setHeader('Location', '/private/location');
    response.setHeader('RateLimit', 'limit=10, remaining=0, reset=3600');
    response.setHeader('Retry-After', '3600');
    response.setHeader('WWW-Authenticate', 'Bearer realm="oms-api"');
    response.setHeader('X-Internal-Diagnostic', RESPONSE_SECRET);
    throw new UnauthorizedException(RESPONSE_SECRET);
  }

  @Get('after-commit')
  public afterCommit(@Res() response: ExpressResponse): never {
    response.status(202).type('text/plain').write('partial-response');
    throw new Error(UNEXPECTED_SECRET);
  }

  @Get('after-end')
  public afterEnd(@Res() response: ExpressResponse): never {
    response.status(204).end();
    throw new BadRequestException(RESPONSE_SECRET);
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
      .map((line): LogRecord => JSON.parse(line) as LogRecord);
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

interface ProblemExpectation {
  readonly detail: string;
  readonly status: number;
  readonly title: string;
}

function databaseConnection(): DatabaseConnection {
  return {
    close: jest.fn((): Promise<void> => Promise.resolve()),
    probe: jest.fn((): Promise<void> => Promise.resolve()),
  };
}

async function startApi(): Promise<RunningApi> {
  const logs = new InMemoryLogStream();
  const moduleReference = await Test.createTestingModule({
    imports: [
      ApiModule.register({
        createDatabaseConnection: databaseConnection,
        observability: {
          deploymentEnvironment: 'test',
          level: 'info',
          stream: logs,
        },
      }),
    ],
    controllers: [ProblemProbeController],
  }).compile();
  const application = moduleReference.createNestApplication<NestExpressApplication>(
    createApiExpressAdapter(),
    {
      bodyParser: false,
      bufferLogs: true,
    },
  );

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

async function expectProblem(
  response: Response,
  expected: ProblemExpectation,
  expectedCorrelationId?: string,
): Promise<Readonly<{ correlationId: string; rawBody: string; requestId: string }>> {
  const requestId = response.headers.get('x-request-id');
  const correlationId = response.headers.get('x-correlation-id');
  const rawBody = await response.text();

  expect(response.status).toBe(expected.status);
  expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(requestId).toMatch(UUID_V4);
  expect(correlationId).toBe(expectedCorrelationId ?? requestId);

  if (requestId === null || correlationId === null) {
    throw new Error('Expected request identity response headers');
  }

  expect(JSON.parse(rawBody) as unknown).toEqual({
    type: 'about:blank',
    title: expected.title,
    status: expected.status,
    detail: expected.detail,
    instance: `urn:uuid:${requestId}`,
    requestId,
    correlationId,
  });

  return { correlationId, rawBody, requestId };
}

function completionLog(logs: InMemoryLogStream): LogRecord {
  const matches = logs
    .records()
    .filter((record): boolean => record['event'] === 'http.request.completed');

  expect(matches).toHaveLength(1);

  const record = matches[0];

  if (record === undefined) {
    throw new Error('Expected one HTTP completion log');
  }

  return record;
}

async function abortJsonRequest(baseUrl: string): Promise<void> {
  const url = new URL(baseUrl);

  await new Promise<void>((resolve, reject): void => {
    const socket = createConnection({
      host: url.hostname,
      port: Number(url.port),
    });
    let connected = false;

    socket.once('connect', (): void => {
      connected = true;
      socket.write(
        [
          'POST /api/v1/problem-probe/body HTTP/1.1',
          `Host: ${url.host}`,
          'Content-Type: application/json',
          'Content-Length: 100000',
          'Connection: close',
          '',
          `{"value":"${PARSER_SECRET}`,
        ].join('\r\n'),
      );
      setTimeout((): void => {
        socket.destroy();
      }, 10);
    });
    socket.once('close', (): void => {
      resolve();
    });
    socket.once('error', (error): void => {
      if (!connected) {
        reject(error);
      }
    });
  });
}

async function waitForLogEvent(logs: InMemoryLogStream, event: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (logs.records().some((record): boolean => record['event'] === event)) {
      return;
    }

    await delay(10);
  }
}

describe('API Problem Details contract', (): void => {
  let runningApi: RunningApi;

  beforeAll(async (): Promise<void> => {
    runningApi = await startApi();
  });

  beforeEach((): void => {
    runningApi.logs.clear();
  });

  afterAll(async (): Promise<void> => {
    await runningApi.application.close();
  });

  it('returns an opaque fixed 404 without exposing the unmatched target', async (): Promise<void> => {
    const pathSecret = 'private-customer-reference';
    const querySecret = 'private-query-token';
    const response = await fetch(
      `${runningApi.baseUrl}/api/v1/missing/${pathSecret}?token=${querySecret}`,
      {
        headers: {
          Accept: 'text/html',
          'X-Correlation-Id': CORRELATION_ID,
        },
      },
    );
    const result = await expectProblem(
      response,
      {
        status: 404,
        title: 'Not Found',
        detail: 'The requested resource was not found.',
      },
      NORMALIZED_CORRELATION_ID,
    );
    await allowResponseLoggingToComplete();

    expect(completionLog(runningApi.logs)).toMatchObject({
      correlationId: result.correlationId,
      http: { method: 'GET', route: '/api/{*splat}', statusCode: 404 },
      level: 'info',
      requestId: result.requestId,
    });
    expect(result.rawBody).not.toContain(pathSecret);
    expect(result.rawBody).not.toContain(querySecret);
    expect(runningApi.logs.serialized()).not.toContain(pathSecret);
    expect(runningApi.logs.serialized()).not.toContain(querySecret);
  });

  it('discards an arbitrary HttpException response and preserves only its supported status', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/bad-request`);
    const result = await expectProblem(response, {
      status: 400,
      title: 'Bad Request',
      detail: 'The request is invalid.',
    });
    await allowResponseLoggingToComplete();

    expect(result.rawBody).not.toContain(RESPONSE_SECRET);
    expect(result.rawBody).not.toContain('attacker.example');
    expect(result.requestId).not.toBe(OVERWRITTEN_REQUEST_ID);
    expect(result.correlationId).not.toBe(OVERWRITTEN_CORRELATION_ID);
    expect(runningApi.logs.serialized()).not.toContain(RESPONSE_SECRET);
    expect(runningApi.logs.serialized()).not.toContain(OVERWRITTEN_REQUEST_ID);
    expect(runningApi.logs.serialized()).not.toContain(OVERWRITTEN_CORRELATION_ID);
    expect(runningApi.logs.records()).toHaveLength(1);
  });

  it('uses Problem Details for an ordinary application 503, not the health representation', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/unavailable`);
    const result = await expectProblem(response, {
      status: 503,
      title: 'Service Unavailable',
      detail: 'The service is temporarily unavailable.',
    });
    await allowResponseLoggingToComplete();

    expect(result.rawBody).not.toContain(RESPONSE_SECRET);
    expect(result.rawBody).not.toContain('private-mysql-host');
    expect(completionLog(runningApi.logs)).toMatchObject({
      http: { route: '/api/v1/problem-probe/unavailable', statusCode: 503 },
      level: 'error',
    });
    expect(runningApi.logs.records()).toContainEqual(
      expect.objectContaining({
        event: 'http.exception.unexpected',
        level: 'error',
        requestId: result.requestId,
      }),
    );
  });

  it('preserves only status-appropriate rate-limit headers for 429', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/rate-limited`);
    await expectProblem(response, {
      status: 429,
      title: 'Too Many Requests',
      detail: 'Too many requests were received. Retry later.',
    });
    await allowResponseLoggingToComplete();

    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('ratelimit')).toBe('limit=10, remaining=0, reset=60');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(completionLog(runningApi.logs)).toMatchObject({
      http: { route: '/api/v1/problem-probe/rate-limited', statusCode: 429 },
      level: 'warn',
    });
    expect(runningApi.logs.records()).toHaveLength(1);
  });

  it.each([
    ['/api/v1/problem-probe/unexpected', UNEXPECTED_SECRET],
    ['/api/v1/problem-probe/unsupported-status', RESPONSE_SECRET],
    ['/api/v1/problem-probe/unauthorized-without-challenge', RESPONSE_SECRET],
  ] as const)(
    'fails an unsafe exception at %s closed to 500',
    async (path, secret): Promise<void> => {
      const response = await fetch(`${runningApi.baseUrl}${path}`);
      const result = await expectProblem(response, {
        status: 500,
        title: 'Internal Server Error',
        detail: 'The service could not complete the request.',
      });
      await allowResponseLoggingToComplete();
      const records = runningApi.logs.records();

      expect(records).toHaveLength(2);
      expect(records).toContainEqual(
        expect.objectContaining({
          event: 'http.exception.unexpected',
          level: 'error',
          requestId: result.requestId,
        }),
      );
      expect(completionLog(runningApi.logs)).toMatchObject({
        http: { statusCode: 500 },
        level: 'error',
      });
      expect(result.rawBody).not.toContain(secret);
      expect(runningApi.logs.serialized()).not.toContain(secret);
      runningApi.logs.clear();
    },
  );

  it('rejects 401 before authentication owns its challenge and removes unsafe headers', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/unauthorized`);
    await expectProblem(response, {
      status: 500,
      title: 'Internal Server Error',
      detail: 'The service could not complete the request.',
    });
    await allowResponseLoggingToComplete();

    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('last-modified')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('ratelimit')).toBeNull();
    expect(response.headers.get('retry-after')).toBeNull();
    expect(response.headers.get('x-internal-diagnostic')).toBeNull();
    expect(runningApi.logs.serialized()).not.toContain(RESPONSE_SECRET);
    expect(runningApi.logs.records()).toHaveLength(2);
  });

  it('parses valid JSON after the early observability middleware', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/body`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderReference: 'safe-reference' }),
    });
    const body = (await response.json()) as unknown;
    await allowResponseLoggingToComplete();

    expect(response.status).toBe(201);
    expect(body).toEqual({ body: { orderReference: 'safe-reference' } });
    expect(completionLog(runningApi.logs)).toMatchObject({
      http: { method: 'POST', route: '/api/v1/problem-probe/body', statusCode: 201 },
      level: 'info',
    });
  });

  it('returns a safe logged 400 for malformed JSON before route matching', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/body`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': CORRELATION_ID,
      },
      body: `{"value":"${PARSER_SECRET}"`,
    });
    const result = await expectProblem(
      response,
      {
        status: 400,
        title: 'Bad Request',
        detail: 'The request is invalid.',
      },
      NORMALIZED_CORRELATION_ID,
    );
    await allowResponseLoggingToComplete();

    expect(completionLog(runningApi.logs)).toMatchObject({
      correlationId: result.correlationId,
      http: { method: 'POST', route: 'unmatched', statusCode: 400 },
      level: 'info',
      requestId: result.requestId,
    });
    expect(result.rawBody).not.toContain(PARSER_SECRET);
    expect(runningApi.logs.serialized()).not.toContain(PARSER_SECRET);
  });

  it('returns a safe logged 413 when JSON exceeds the explicit byte limit', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/body`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(API_REQUEST_BODY_LIMIT_BYTES) }),
    });
    await expectProblem(response, {
      status: 413,
      title: 'Content Too Large',
      detail: 'The request content exceeds the allowed size.',
    });
    await allowResponseLoggingToComplete();

    expect(completionLog(runningApi.logs)).toMatchObject({
      http: { method: 'POST', route: 'unmatched', statusCode: 413 },
      level: 'info',
    });
    expect(runningApi.logs.records()).toHaveLength(1);
  });

  it.each(['br', 'compress', 'deflate', 'gzip'] as const)(
    'returns a safe logged 415 for %s-encoded JSON',
    async (contentEncoding): Promise<void> => {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/body`, {
        method: 'POST',
        headers: {
          'Content-Encoding': contentEncoding,
          'Content-Type': 'application/json',
        },
        body: `{"value":"${PARSER_SECRET}`,
      });
      await expectProblem(response, {
        status: 415,
        title: 'Unsupported Media Type',
        detail: 'The request media type is not supported.',
      });
      await allowResponseLoggingToComplete();

      expect(completionLog(runningApi.logs)).toMatchObject({
        http: { method: 'POST', route: 'unmatched', statusCode: 415 },
        level: 'info',
      });
      expect(runningApi.logs.serialized()).not.toContain(PARSER_SECRET);
      runningApi.logs.clear();
    },
  );

  it('keeps Problem Details headers but emits no representation body for HEAD', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/unexpected`, {
      method: 'HEAD',
    });
    const rawBody = await response.text();
    await allowResponseLoggingToComplete();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(UUID_V4);
    expect(rawBody).toBe('');
    expect(completionLog(runningApi.logs)).toMatchObject({
      http: { method: 'HEAD', route: '/api/v1/problem-probe/unexpected', statusCode: 500 },
      level: 'error',
    });
  });

  it('does not append a problem representation after response headers are committed', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/after-commit`);
    const rawBody = await response.text();
    await allowResponseLoggingToComplete();

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(rawBody).toBe('partial-response');
    expect(rawBody).not.toContain('about:blank');
    expect(runningApi.logs.serialized()).not.toContain(UNEXPECTED_SECRET);
    expect(runningApi.logs.records()).toContainEqual(
      expect.objectContaining({
        event: 'http.exception.unexpected',
        level: 'error',
      }),
    );
  });

  it('logs an expected exception thrown after a successful response has ended', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/problem-probe/after-end`);
    const rawBody = await response.text();
    await allowResponseLoggingToComplete();
    const records = runningApi.logs.records();

    expect(response.status).toBe(204);
    expect(rawBody).toBe('');
    expect(records).toHaveLength(2);
    expect(records).toContainEqual(
      expect.objectContaining({
        event: 'http.exception.unexpected',
        level: 'error',
      }),
    );
    expect(completionLog(runningApi.logs)).toMatchObject({
      http: { route: '/api/v1/problem-probe/after-end', statusCode: 204 },
      level: 'info',
    });
    expect(runningApi.logs.serialized()).not.toContain(RESPONSE_SECRET);
  });

  it('records a client-aborted parser request as one safe warning', async (): Promise<void> => {
    await abortJsonRequest(runningApi.baseUrl);
    await waitForLogEvent(runningApi.logs, 'http.request.aborted');
    const records = runningApi.logs.records();
    const abortLogs = records.filter(
      (record): boolean => record['event'] === 'http.request.aborted',
    );

    expect(records).toHaveLength(1);
    expect(abortLogs).toHaveLength(1);
    const abortLog = abortLogs[0];

    if (abortLog === undefined) {
      throw new Error('Expected one client-abort warning');
    }

    expect(abortLog).toMatchObject({
      http: { method: 'POST', route: 'unmatched' },
      level: 'warn',
    });
    expect(abortLog['requestId']).toMatch(UUID_V4);
    expect(abortLog['correlationId']).toBe(abortLog['requestId']);
    expect(runningApi.logs.serialized()).not.toContain(PARSER_SECRET);
  });
});
