import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, type ArgumentsHost } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

import {
  ensureRequestIdentity,
  setRequestIdentityResponseHeaders,
} from '../observability/request-identity';

import {
  createProblemDetails,
  PROBLEM_DETAILS_CACHE_CONTROL,
  PROBLEM_DETAILS_CONTENT_TYPE,
} from './problem-details.contract';
import { internalServerErrorDescriptor } from './problem-descriptors';
import type { ProblemMapping } from './problem-mapper';

const PRESERVED_RESPONSE_HEADERS = new Set([
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-expose-headers',
  'content-security-policy',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'vary',
  'x-content-type-options',
  'x-frame-options',
]);
const RATE_LIMIT_HEADERS = new Set([
  'ratelimit',
  'ratelimit-policy',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
]);

function preservesResponseHeader(header: string, status: number): boolean {
  if (PRESERVED_RESPONSE_HEADERS.has(header)) {
    return true;
  }

  if (header === 'retry-after') {
    return status === 429 || status === 503;
  }

  if (RATE_LIMIT_HEADERS.has(header)) {
    return status === 429;
  }

  return false;
}

@Injectable()
export class ProblemDetailsResponseWriter {
  public constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProblemDetailsResponseWriter.name);
  }

  public write(host: ArgumentsHost, exception: unknown, mapping: ProblemMapping): void {
    const http = host.switchToHttp();
    const request = http.getRequest<IncomingMessage>();
    const response = http.getResponse<ServerResponse>();
    const adapter = this.adapterHost.httpAdapter;

    if (response.writableEnded) {
      this.logUnexpectedException(exception, request);
      return;
    }

    if (response.destroyed) {
      if (mapping.unexpected) {
        this.logUnexpectedException(exception, request);
      }

      return;
    }

    if (adapter.isHeadersSent(response)) {
      this.logUnexpectedException(exception, request);
      this.endIncompleteResponse(response);
      return;
    }

    const identity = ensureRequestIdentity(request, response);

    if (mapping.unexpected) {
      this.logUnexpectedException(exception, request);
    }

    const body = createProblemDetails(mapping.descriptor, identity);

    for (const header of response.getHeaderNames()) {
      if (!preservesResponseHeader(header.toLowerCase(), mapping.descriptor.status)) {
        response.removeHeader(header);
      }
    }

    setRequestIdentityResponseHeaders(response, identity);
    adapter.setHeader(response, 'Cache-Control', PROBLEM_DETAILS_CACHE_CONTROL);
    adapter.setHeader(response, 'Content-Type', PROBLEM_DETAILS_CONTENT_TYPE);
    adapter.reply(response, body, mapping.descriptor.status);
  }

  public writeUnexpected(host: ArgumentsHost, exception: unknown): void {
    this.write(host, exception, {
      descriptor: internalServerErrorDescriptor(),
      unexpected: true,
    });
  }

  private logUnexpectedException(exception: unknown, request?: IncomingMessage): void {
    try {
      const record = {
        component: ProblemDetailsResponseWriter.name,
        err: exception,
        event: 'http.exception.unexpected',
      };

      if (request?.log === undefined) {
        this.logger.error(record, 'Unexpected HTTP exception');
      } else {
        request.log.error(record, 'Unexpected HTTP exception');
      }
    } catch {
      // A logging failure must never replace the safe HTTP failure response.
    }
  }

  private endIncompleteResponse(response: ServerResponse): void {
    if (response.destroyed || response.writableEnded) {
      return;
    }

    try {
      this.adapterHost.httpAdapter.end(response);
    } catch {
      // The response is already committed; there is no safe body to recover.
    }
  }
}
