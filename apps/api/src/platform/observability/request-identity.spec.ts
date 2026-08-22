import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  assignRequestIdentity,
  CORRELATION_ID_HEADER,
  getRequestIdentity,
  REQUEST_ID_HEADER,
  resolveCorrelationId,
} from './request-identity';

const FALLBACK_REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';
const UUID_V7 = '01890f3e-9d2b-7cc1-98a2-123456789abc';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function createRequest(rawHeaders: readonly string[]): IncomingMessage {
  return { rawHeaders: [...rawHeaders] } as unknown as IncomingMessage;
}

function createResponse(): {
  readonly response: ServerResponse;
  readonly setHeader: jest.Mock;
} {
  const setHeader = jest.fn();

  return {
    response: { setHeader } as unknown as ServerResponse,
    setHeader,
  };
}

describe('request identity', (): void => {
  describe('resolveCorrelationId', (): void => {
    it.each([
      ['UUID v4', UUID_V4.toUpperCase(), UUID_V4],
      ['UUID v7', UUID_V7.toUpperCase(), UUID_V7],
    ])('accepts and normalizes a canonical %s', (_label, supplied, expected): void => {
      expect(resolveCorrelationId(['X-Correlation-Id', supplied], FALLBACK_REQUEST_ID)).toBe(
        expected,
      );
    });

    it.each([
      ['missing', []],
      ['malformed', ['X-Correlation-Id', 'not-a-uuid']],
      ['comma-combined', ['X-Correlation-Id', `${UUID_V4},${UUID_V7}`]],
      ['CR/LF-bearing', ['X-Correlation-Id', `${UUID_V4}\r\nInjected: value`]],
      ['duplicated', ['X-Correlation-Id', UUID_V4, 'x-correlation-id', UUID_V7]],
      ['oversized', ['X-Correlation-Id', `${UUID_V4}0`]],
    ] as const)(
      'uses the request ID fallback when the correlation header is %s',
      (_label, rawHeaders): void => {
        expect(resolveCorrelationId(rawHeaders, FALLBACK_REQUEST_ID)).toBe(FALLBACK_REQUEST_ID);
      },
    );
  });

  describe('assignRequestIdentity', (): void => {
    it('generates the request ID and writes both identity response headers', (): void => {
      const request = createRequest(['X-Correlation-Id', UUID_V7.toUpperCase()]);
      const { response, setHeader } = createResponse();

      const requestId = assignRequestIdentity(request, response);

      expect(requestId).toMatch(UUID_V4_PATTERN);
      expect(setHeader).toHaveBeenNthCalledWith(1, REQUEST_ID_HEADER, requestId);
      expect(setHeader).toHaveBeenNthCalledWith(2, CORRELATION_ID_HEADER, UUID_V7);
      expect(setHeader).toHaveBeenCalledTimes(2);
      expect(getRequestIdentity(request)).toEqual({
        requestId,
        correlationId: UUID_V7,
      });
    });

    it('ignores an inbound request ID and uses a server-generated identity', (): void => {
      const untrustedRequestId = '11111111-1111-4111-8111-111111111111';
      const request = createRequest(['X-Request-Id', untrustedRequestId]);
      const { response, setHeader } = createResponse();

      const requestId = assignRequestIdentity(request, response);

      expect(requestId).toMatch(UUID_V4_PATTERN);
      expect(requestId).not.toBe(untrustedRequestId);
      expect(getRequestIdentity(request)).toEqual({
        requestId,
        correlationId: requestId,
      });
      expect(setHeader).toHaveBeenNthCalledWith(1, REQUEST_ID_HEADER, requestId);
      expect(setHeader).toHaveBeenNthCalledWith(2, CORRELATION_ID_HEADER, requestId);
    });

    it('replaces a generic request ID assigned before identity initialization', (): void => {
      const request = createRequest([]);
      const { response } = createResponse();

      request.id = 'earlier-middleware-value';

      const requestId = assignRequestIdentity(request, response);

      expect(requestId).toMatch(UUID_V4_PATTERN);
      expect(request.id).toBe(requestId);
      expect(requestId).not.toBe('earlier-middleware-value');
    });
  });
});
