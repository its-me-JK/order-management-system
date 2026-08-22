import { Writable } from 'node:stream';

import { Body, Controller, Injectable, Post, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { DatabaseConnection } from '@oms/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsObject,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Logger } from 'nestjs-pino';

import { configureApiApplication, createApiExpressAdapter } from './api.application';
import { ApiModule } from './api.module';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PRIVATE_INPUT = 'private-validation-input';

class DeliveryAddressDto {
  @IsString()
  @Length(2, 80)
  public readonly line1!: string;

  @IsString()
  @Length(2, 64)
  public readonly city!: string;
}

class ValidationProbeRequestDto {
  @IsString()
  @Length(3, 64)
  public readonly customerReference!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  public readonly deliveryAddress!: DeliveryAddressDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @Length(1, 32, { each: true })
  public readonly tags!: readonly string[];
}

@Injectable()
class ValidationInvocationProbe {
  public count = 0;
  public lastBody: ValidationProbeRequestDto | undefined;

  public record(body: ValidationProbeRequestDto): void {
    this.count += 1;
    this.lastBody = body;
  }

  public reset(): void {
    this.count = 0;
    this.lastBody = undefined;
  }
}

@Controller('validation-probe')
class ValidationProbeController {
  public constructor(private readonly probe: ValidationInvocationProbe) {}

  @Post()
  public create(
    @Body() body: ValidationProbeRequestDto,
  ): Readonly<{ accepted: true; body: ValidationProbeRequestDto }> {
    this.probe.record(body);

    return { accepted: true, body };
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
  readonly probe: ValidationInvocationProbe;
}

interface InvalidRequestCase {
  readonly body: unknown;
  readonly name: string;
  readonly route?: string;
}

const VALID_REQUEST = Object.freeze({
  customerReference: 'customer-123',
  deliveryAddress: Object.freeze({
    line1: '12 Market Street',
    city: 'Bengaluru',
  }),
  tags: Object.freeze(['priority']),
});

const INVALID_REQUESTS: readonly InvalidRequestCase[] = [
  {
    name: 'a missing required field',
    body: {
      deliveryAddress: VALID_REQUEST.deliveryAddress,
      tags: [PRIVATE_INPUT],
    },
  },
  {
    name: 'an unknown root field',
    body: { ...VALID_REQUEST, unexpected: PRIVATE_INPUT },
  },
  {
    name: 'an unknown nested field',
    body: {
      ...VALID_REQUEST,
      deliveryAddress: { ...VALID_REQUEST.deliveryAddress, unexpected: PRIVATE_INPUT },
    },
  },
  {
    name: 'an array for a single nested object',
    body: { ...VALID_REQUEST, deliveryAddress: [], tags: [PRIVATE_INPUT] },
  },
  {
    name: 'an object array for a single nested object',
    body: {
      ...VALID_REQUEST,
      deliveryAddress: [VALID_REQUEST.deliveryAddress],
      tags: [PRIVATE_INPUT],
    },
  },
  {
    name: 'a numeric value for a string field',
    body: { ...VALID_REQUEST, customerReference: 123, tags: [PRIVATE_INPUT] },
  },
  {
    name: 'a value outside its declared bounds',
    body: { ...VALID_REQUEST, customerReference: 'x', tags: [PRIVATE_INPUT] },
  },
  {
    name: 'a scalar value for an array field',
    body: { ...VALID_REQUEST, tags: PRIVATE_INPUT },
  },
  { name: 'null instead of an object', body: null, route: 'unmatched' },
  {
    name: 'an array instead of an object',
    body: [{ ...VALID_REQUEST, tags: [PRIVATE_INPUT] }],
  },
];

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
    controllers: [ValidationProbeController],
    providers: [ValidationInvocationProbe],
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
    probe: moduleReference.get(ValidationInvocationProbe),
  };
}

async function allowResponseLoggingToComplete(): Promise<void> {
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
}

describe('API transport validation', (): void => {
  let runningApi: RunningApi;

  beforeAll(async (): Promise<void> => {
    runningApi = await startApi();
  });

  beforeEach((): void => {
    runningApi.logs.clear();
    runningApi.probe.reset();
  });

  afterAll(async (): Promise<void> => {
    await runningApi.application.close();
  });

  it('accepts an exact DTO without mutating or coercing the request', async (): Promise<void> => {
    const response = await fetch(`${runningApi.baseUrl}/api/v1/validation-probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    const responseBody = (await response.json()) as unknown;
    await allowResponseLoggingToComplete();

    expect(response.status).toBe(201);
    expect(responseBody).toEqual({ accepted: true, body: VALID_REQUEST });
    expect(runningApi.probe.count).toBe(1);
    expect(runningApi.probe.lastBody).toEqual(VALID_REQUEST);
    expect(runningApi.probe.lastBody).not.toBeInstanceOf(ValidationProbeRequestDto);
    expect(runningApi.logs.records()).toHaveLength(1);
    expect(runningApi.logs.records()[0]).toMatchObject({
      event: 'http.request.completed',
      http: {
        method: 'POST',
        route: '/api/v1/validation-probe',
        statusCode: 201,
      },
      level: 'info',
    });
  });

  it.each(INVALID_REQUESTS)(
    'rejects $name before controller invocation',
    async ({ body, route = '/api/v1/validation-probe' }) => {
      const response = await fetch(`${runningApi.baseUrl}/api/v1/validation-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const requestId = response.headers.get('x-request-id');
      const correlationId = response.headers.get('x-correlation-id');
      const responseBody = (await response.json()) as unknown;
      await allowResponseLoggingToComplete();

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(requestId).toMatch(UUID_V4);
      expect(correlationId).toBe(requestId);
      expect(responseBody).toEqual({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'The request is invalid.',
        instance: `urn:uuid:${requestId ?? ''}`,
        requestId,
        correlationId,
      });
      expect(runningApi.probe.count).toBe(0);
      expect(runningApi.logs.serialized()).not.toContain(PRIVATE_INPUT);
      expect(runningApi.logs.records()).toHaveLength(1);
      expect(runningApi.logs.records()[0]).toMatchObject({
        event: 'http.request.completed',
        http: {
          method: 'POST',
          route,
          statusCode: 400,
        },
        level: 'info',
      });
    },
  );
});
