import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  Catch,
  Injectable,
  ServiceUnavailableException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { ProblemDetailsResponseWriter } from '../http-errors/problem-details.response-writer';
import {
  ensureRequestIdentity,
  setRequestIdentityResponseHeaders,
} from '../observability/request-identity';

import {
  canonicalizeOperationalHealthFailureResponse,
  OPERATIONAL_HEALTH_CACHE_CONTROL,
  OPERATIONAL_HEALTH_CONTENT_TYPE,
  type OperationalHealthEndpoint,
} from './operational-health-response';

interface HealthRouteRequest extends IncomingMessage {
  readonly route?: Readonly<{ path?: unknown }>;
}

function operationalHealthEndpoint(
  request: HealthRouteRequest,
): OperationalHealthEndpoint | undefined {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return undefined;
  }

  const route = request.route?.path;

  return route === '/health/live' ? 'live' : route === '/health/ready' ? 'ready' : undefined;
}

@Catch(ServiceUnavailableException)
@Injectable()
export class OperationalHealthExceptionFilter implements ExceptionFilter<ServiceUnavailableException> {
  public constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly problemDetailsWriter: ProblemDetailsResponseWriter,
  ) {}

  public catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HealthRouteRequest>();
    const response = http.getResponse<ServerResponse>();
    const candidate = this.exceptionResponse(exception);
    const endpoint = operationalHealthEndpoint(request);
    const healthResponse =
      endpoint === undefined
        ? undefined
        : canonicalizeOperationalHealthFailureResponse(candidate, endpoint);

    if (healthResponse === undefined) {
      this.problemDetailsWriter.writeUnexpected(host, exception);
      return;
    }

    const adapter = this.adapterHost.httpAdapter;

    if (response.writableEnded) {
      this.problemDetailsWriter.writeUnexpected(host, exception);
      return;
    }

    if (response.destroyed) {
      return;
    }

    if (adapter.isHeadersSent(response)) {
      this.problemDetailsWriter.writeUnexpected(host, exception);
      return;
    }

    const identity = ensureRequestIdentity(request, response);

    setRequestIdentityResponseHeaders(response, identity);
    adapter.setHeader(response, 'Cache-Control', OPERATIONAL_HEALTH_CACHE_CONTROL);
    adapter.setHeader(response, 'Content-Type', OPERATIONAL_HEALTH_CONTENT_TYPE);
    adapter.reply(response, healthResponse, 503);
  }

  private exceptionResponse(exception: ServiceUnavailableException): unknown {
    try {
      return exception.getResponse();
    } catch {
      return undefined;
    }
  }
}
