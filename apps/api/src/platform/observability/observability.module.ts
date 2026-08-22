import { type DynamicModule, Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import pinoHttp, { type HttpLogger } from 'pino-http';

import { createHttpLoggerParameters, type ApiObservabilityOptions } from './http-logger.options';

export const API_HTTP_LOGGING_MIDDLEWARE = Symbol('API_HTTP_LOGGING_MIDDLEWARE');
export type ApiHttpLoggingMiddleware = HttpLogger;

@Module({})
export class ObservabilityModule {
  public static register(options: ApiObservabilityOptions): DynamicModule {
    const parameters = createHttpLoggerParameters(options);
    const middleware = Array.isArray(parameters) ? pinoHttp(...parameters) : pinoHttp(parameters);

    return {
      module: ObservabilityModule,
      imports: [
        LoggerModule.forRoot({
          forRoutes: [{ method: RequestMethod.ALL, path: '{*splat}' }],
          pinoHttp: { logger: middleware.logger },
          renameContext: 'component',
          useExisting: true,
        }),
      ],
      providers: [
        {
          provide: API_HTTP_LOGGING_MIDDLEWARE,
          useValue: middleware,
        },
      ],
      exports: [API_HTTP_LOGGING_MIDDLEWARE],
    };
  }
}
