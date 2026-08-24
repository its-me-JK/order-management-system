import { RequestMethod, VersioningType } from '@nestjs/common';
import { existsSync } from 'node:fs';

import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';

import { configureApiDocumentation } from './api.documentation';
import {
  API_HTTP_LOGGING_MIDDLEWARE,
  type ApiHttpLoggingMiddleware,
} from './platform/observability/observability.module';

const OPERATIONAL_HEALTH_ROUTES: Readonly<{ path: string; method: RequestMethod }>[] = [
  { path: 'health/live', method: RequestMethod.GET },
  { path: 'health/ready', method: RequestMethod.GET },
];
export const API_REQUEST_BODY_LIMIT_BYTES = 100 * 1_024;

export interface ApiApplicationOptions {
  readonly corsOrigin?: string | null;
  readonly staticDirectory?: string;
}

export function createApiExpressAdapter(): ExpressAdapter {
  const expressApplication = express();

  expressApplication.set('case sensitive routing', true);

  return new ExpressAdapter(expressApplication);
}

export function configureApiApplication(
  application: NestExpressApplication,
  options: ApiApplicationOptions = {},
): void {
  application.use(application.get<ApiHttpLoggingMiddleware>(API_HTTP_LOGGING_MIDDLEWARE));
  application.useBodyParser('json', {
    inflate: false,
    limit: API_REQUEST_BODY_LIMIT_BYTES,
  });
  application.disable('etag');
  application.disable('x-powered-by');

  if (options.corsOrigin !== undefined && options.corsOrigin !== null) {
    application.enableCors({
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Correlation-Id',
        'X-CSRF-Token',
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PATCH'],
      origin: options.corsOrigin,
    });
  }
  application.setGlobalPrefix('api', {
    exclude: OPERATIONAL_HEALTH_ROUTES,
  });
  application.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });
  configureApiDocumentation(application);

  if (options.staticDirectory !== undefined && existsSync(options.staticDirectory)) {
    application.useStaticAssets(options.staticDirectory, { index: 'index.html' });
  }
}
