import { RequestMethod, VersioningType } from '@nestjs/common';

import type { NestExpressApplication } from '@nestjs/platform-express';

import {
  API_HTTP_LOGGING_MIDDLEWARE,
  type ApiHttpLoggingMiddleware,
} from './platform/observability/observability.module';

const OPERATIONAL_HEALTH_ROUTES: Readonly<{ path: string; method: RequestMethod }>[] = [
  { path: 'health/live', method: RequestMethod.GET },
  { path: 'health/ready', method: RequestMethod.GET },
];
export const API_REQUEST_BODY_LIMIT_BYTES = 100 * 1_024;

export function configureApiApplication(application: NestExpressApplication): void {
  application.use(application.get<ApiHttpLoggingMiddleware>(API_HTTP_LOGGING_MIDDLEWARE));
  application.useBodyParser('json', {
    inflate: false,
    limit: API_REQUEST_BODY_LIMIT_BYTES,
  });
  application.disable('etag');
  application.disable('x-powered-by');
  application.setGlobalPrefix('api', {
    exclude: OPERATIONAL_HEALTH_ROUTES,
  });
  application.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });
}
