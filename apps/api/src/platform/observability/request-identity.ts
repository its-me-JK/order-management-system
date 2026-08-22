import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'X-Request-Id';
export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

const CORRELATION_HEADER_NAME = CORRELATION_ID_HEADER.toLowerCase();
const CANONICAL_UUID_V4_OR_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface RequestIdentity {
  readonly requestId: string;
  readonly correlationId: string;
}

const requestIdentities = new WeakMap<IncomingMessage, RequestIdentity>();

function correlationHeaderValues(rawHeaders: readonly string[]): readonly string[] {
  const values: string[] = [];

  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === CORRELATION_HEADER_NAME) {
      const value = rawHeaders[index + 1];

      if (value !== undefined) {
        values.push(value);
      }
    }
  }

  return values;
}

export function resolveCorrelationId(rawHeaders: readonly string[], requestId: string): string {
  const values = correlationHeaderValues(rawHeaders);
  const value = values[0];

  if (values.length !== 1 || value === undefined || !CANONICAL_UUID_V4_OR_V7.test(value)) {
    return requestId;
  }

  return value.toLowerCase();
}

export function assignRequestIdentity(request: IncomingMessage, response: ServerResponse): string {
  return ensureRequestIdentity(request, response).requestId;
}

export function ensureRequestIdentity(
  request: IncomingMessage,
  response: ServerResponse,
): RequestIdentity {
  const existingIdentity = requestIdentities.get(request);

  if (existingIdentity !== undefined) {
    request.id = existingIdentity.requestId;
    return existingIdentity;
  }

  const requestId = randomUUID();
  const identity: RequestIdentity = Object.freeze({
    requestId,
    correlationId: resolveCorrelationId(request.rawHeaders, requestId),
  });

  requestIdentities.set(request, identity);
  request.id = identity.requestId;
  response.setHeader(REQUEST_ID_HEADER, identity.requestId);
  response.setHeader(CORRELATION_ID_HEADER, identity.correlationId);

  return identity;
}

export function getRequestIdentity(request: IncomingMessage): RequestIdentity {
  const identity = requestIdentities.get(request);

  if (identity === undefined) {
    throw new Error('Request identity is unavailable before logging middleware initialization');
  }

  return identity;
}
