import type { IncomingMessage, ServerResponse } from 'node:http';

import type { DeploymentEnvironment, LogLevel } from '@oms/configuration';
import { stdTimeFunctions, type DestinationStream, type LoggerOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';

import { assignRequestIdentity, ensureRequestIdentity } from './request-identity';

const SERVICE_NAME = 'oms-api';
const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';
const CIRCULAR_VALUE = '[CIRCULAR]';
const UNMATCHED_ROUTE = 'unmatched';
const MAXIMUM_LOG_OBJECT_DEPTH = 6;
const MAXIMUM_LOG_OBJECT_FIELDS = 100;
const MAXIMUM_LOG_ARRAY_ENTRIES = 100;
const MAXIMUM_LOG_STRING_LENGTH = 2_048;
const PINO_ERROR_LEVEL = 50;
const PINO_FATAL_LEVEL = 60;
const STABLE_COMPONENT = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const STABLE_EVENT = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,15}$/u;
const SAFE_ROUTE_TEMPLATE = /^\/[A-Za-z0-9_{}*:/.-]{0,255}$/u;
const RESERVED_LOG_FIELDS = new Set([
  'correlationId',
  'deploymentEnvironment',
  'level',
  'requestId',
  'service',
  'time',
]);
const SAFE_ERROR_TYPES = new Set([
  'AggregateError',
  'Error',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'UnexpectedError',
]);
const STANDARD_HTTP_METHODS = new Set([
  'CONNECT',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
  'TRACE',
]);
const SENSITIVE_FIELD_NAMES = new Set([
  'apikey',
  'authorization',
  'cardnumber',
  'clientsecret',
  'cookie',
  'cvc',
  'cvv',
  'idempotencykey',
  'pan',
  'password',
  'passwd',
  'privatekey',
  'secret',
  'setcookie',
  'token',
]);
const SENSITIVE_FIELD_SUFFIXES = [
  'apikey',
  'authorization',
  'card',
  'cardnumber',
  'clientsecret',
  'cookie',
  'cvc',
  'cvv',
  'idempotencykey',
  'pan',
  'password',
  'passwd',
  'privatekey',
  'secret',
  'token',
] as const;
const SENSITIVE_FIELD_PREFIXES = ['apikey', 'authorization', 'cookie', 'setcookie'] as const;

interface ExpressRouteRequest extends IncomingMessage {
  readonly route?: Readonly<{ path?: unknown }>;
}

interface HttpLogMetadata {
  readonly event: 'http.request.aborted' | 'http.request.completed';
  readonly http: Readonly<{
    durationMs: number;
    method: string;
    route: string;
    statusCode: number;
  }>;
}

export interface ApiObservabilityOptions {
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly level: LogLevel;
  readonly stream?: DestinationStream;
}

function normalizedFieldName(fieldName: string): string {
  return fieldName.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
}

function isSensitiveFieldName(fieldName: string): boolean {
  const normalized = normalizedFieldName(fieldName);

  return (
    SENSITIVE_FIELD_NAMES.has(normalized) ||
    SENSITIVE_FIELD_SUFFIXES.some((suffix): boolean => normalized.endsWith(suffix)) ||
    SENSITIVE_FIELD_PREFIXES.some((prefix): boolean => normalized.startsWith(prefix))
  );
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length <= MAXIMUM_LOG_STRING_LENGTH
      ? value
      : `${value.slice(0, MAXIMUM_LOG_STRING_LENGTH)}${TRUNCATED_VALUE}`;
  }

  if (value instanceof Error) {
    return safeError(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAXIMUM_LOG_OBJECT_DEPTH) {
    return TRUNCATED_VALUE;
  }

  if (seen.has(value)) {
    return CIRCULAR_VALUE;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAXIMUM_LOG_ARRAY_ENTRIES)
      .map((entry) => sanitizeValue(entry, seen, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [fieldName, fieldValue] of Object.entries(value).slice(0, MAXIMUM_LOG_OBJECT_FIELDS)) {
    sanitized[fieldName] = isSensitiveFieldName(fieldName)
      ? REDACTED_VALUE
      : sanitizeValue(fieldValue, seen, depth + 1);
  }

  return sanitized;
}

function sanitizeRecord(record: object): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const seen = new WeakSet<object>();

  for (const [fieldName, value] of Object.entries(record)) {
    if (RESERVED_LOG_FIELDS.has(fieldName)) {
      continue;
    }

    sanitized[fieldName] = isSensitiveFieldName(fieldName)
      ? REDACTED_VALUE
      : sanitizeValue(value, seen, 0);
  }

  return sanitized;
}

function safeError(error: unknown): Readonly<{ code: string; type: string }> {
  const candidate =
    error instanceof Error
      ? error.name
      : typeof error === 'object' && error !== null && 'type' in error
        ? readObjectField(error, 'type')
        : undefined;
  const type =
    typeof candidate === 'string' && SAFE_ERROR_TYPES.has(candidate)
      ? candidate
      : 'UnexpectedError';

  return {
    code: 'UNEXPECTED_ERROR',
    type,
  };
}

function containsError(value: unknown): boolean {
  return (
    value instanceof Error ||
    (typeof value === 'object' && value !== null && ('err' in value || 'error' in value))
  );
}

function readObjectField(record: object, fieldName: string): unknown {
  return Reflect.get(record, fieldName) as unknown;
}

function fixedErrorMessage(value: unknown, level: number): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'event' in value &&
    readObjectField(value, 'event') === 'http.request.completed'
  ) {
    return 'HTTP request failed';
  }

  return level >= PINO_FATAL_LEVEL ? 'Fatal error' : 'Unexpected error';
}

function safeStringField(record: object, fieldName: string, pattern: RegExp): string | undefined {
  const candidate = fieldName in record ? readObjectField(record, fieldName) : undefined;

  return typeof candidate === 'string' && pattern.test(candidate) ? candidate : undefined;
}

function safeRouteTemplate(value: unknown): string {
  return typeof value === 'string' && SAFE_ROUTE_TEMPLATE.test(value) ? value : UNMATCHED_ROUTE;
}

function safeHttpMetadata(value: unknown): HttpLogMetadata['http'] {
  if (typeof value !== 'object' || value === null) {
    return {
      durationMs: 0,
      method: 'OTHER',
      route: UNMATCHED_ROUTE,
      statusCode: 500,
    };
  }

  const duration = readObjectField(value, 'durationMs');
  const method = readObjectField(value, 'method');
  const statusCode = readObjectField(value, 'statusCode');

  return {
    durationMs:
      typeof duration === 'number' && Number.isFinite(duration)
        ? Math.max(0, Math.round(duration))
        : 0,
    method: safeHttpMethod(typeof method === 'string' ? method : undefined),
    route: safeRouteTemplate(readObjectField(value, 'route')),
    statusCode:
      typeof statusCode === 'number' &&
      Number.isInteger(statusCode) &&
      statusCode >= 100 &&
      statusCode <= 599
        ? statusCode
        : 500,
  };
}

function structuredErrorRecord(value: unknown): object {
  if (value instanceof Error) {
    return { err: value };
  }

  if (typeof value !== 'object' || value === null) {
    return { err: { type: 'UnexpectedError' } };
  }

  const component = safeStringField(value, 'component', STABLE_COMPONENT);
  const event = safeStringField(value, 'event', STABLE_EVENT);

  if (event === 'http.request.completed') {
    return {
      event,
      http: safeHttpMetadata(readObjectField(value, 'http')),
    };
  }

  const error =
    'err' in value
      ? readObjectField(value, 'err')
      : 'error' in value
        ? readObjectField(value, 'error')
        : { type: 'UnexpectedError' };

  return {
    ...(component === undefined ? {} : { component }),
    ...(event === undefined ? {} : { event }),
    err: error,
  };
}

function safeHttpMethod(method: string | undefined): string {
  return method !== undefined && STANDARD_HTTP_METHODS.has(method) ? method : 'OTHER';
}

function routeTemplate(request: ExpressRouteRequest): string {
  return safeRouteTemplate(request.route?.path);
}

function operationalHealthRoute(request: IncomingMessage): string | undefined {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return undefined;
  }

  const route = routeTemplate(request);

  return route === '/health/live' || route === '/health/ready' ? route : undefined;
}

function requestWasAborted(request: IncomingMessage, response: ServerResponse): boolean {
  return request.readableAborted || !response.writableEnded;
}

function responseTime(value: unknown): number {
  if (typeof value !== 'object' || value === null || !('responseTime' in value)) {
    return 0;
  }

  const candidate = Reflect.get(value, 'responseTime');

  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : 0;
}

function httpLogMetadata(
  request: IncomingMessage,
  response: ServerResponse,
  durationMilliseconds: number,
): HttpLogMetadata {
  const aborted = requestWasAborted(request, response);

  return {
    event: aborted ? 'http.request.aborted' : 'http.request.completed',
    http: {
      durationMs: Math.max(0, Math.round(durationMilliseconds)),
      method: safeHttpMethod(request.method),
      route: routeTemplate(request),
      statusCode: response.statusCode,
    },
  };
}

function pinoOptions(options: ApiObservabilityOptions): PinoHttpOptions {
  const loggerOptions: LoggerOptions = {
    base: {
      deploymentEnvironment: options.deploymentEnvironment,
      service: SERVICE_NAME,
    },
    formatters: {
      level: (label): Readonly<{ level: string }> => ({ level: label }),
      log: sanitizeRecord,
    },
    hooks: {
      logMethod(args, method, level): void {
        if (level >= PINO_ERROR_LEVEL || containsError(args[0])) {
          method.call(this, structuredErrorRecord(args[0]), fixedErrorMessage(args[0], level));
          return;
        }

        method.apply(this, args);
      },
    },
    level: options.level,
    redact: {
      censor: REDACTED_VALUE,
      paths: [
        'authorization',
        'cookie',
        'password',
        'secret',
        'token',
        '*.authorization',
        '*.cookie',
        '*.password',
        '*.secret',
        '*.token',
      ],
    },
    serializers: {
      err: safeError,
      error: safeError,
      req: (): undefined => undefined,
      res: (): undefined => undefined,
    },
    timestamp: stdTimeFunctions.isoTime,
  };

  return {
    ...loggerOptions,
    autoLogging: true,
    customErrorMessage: (): string => 'HTTP request failed',
    customErrorObject: (request, response, _error, value): HttpLogMetadata =>
      httpLogMetadata(request, response, responseTime(value)),
    customLogLevel: (request, response): LogLevel => {
      const healthRoute = operationalHealthRoute(request);

      if (requestWasAborted(request, response)) {
        return 'warn';
      }

      if (healthRoute !== undefined && response.statusCode < 500) {
        return 'silent';
      }

      if (healthRoute !== undefined && response.statusCode === 503) {
        return 'warn';
      }

      if (response.statusCode >= 500) {
        return 'error';
      }

      return response.statusCode === 429 ? 'warn' : 'info';
    },
    customProps: (request, response): Readonly<{ correlationId: string; requestId: string }> =>
      ensureRequestIdentity(request, response),
    customSuccessMessage: (): string => 'HTTP request completed',
    customSuccessObject: (request, response, value): HttpLogMetadata =>
      httpLogMetadata(request, response, responseTime(value)),
    genReqId: assignRequestIdentity,
    wrapSerializers: false,
  };
}

export function createHttpLoggerParameters(
  options: ApiObservabilityOptions,
): PinoHttpOptions | [PinoHttpOptions, DestinationStream] {
  const httpOptions = pinoOptions(options);

  return options.stream === undefined ? httpOptions : [httpOptions, options.stream];
}
