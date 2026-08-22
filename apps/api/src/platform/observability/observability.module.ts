import { type DynamicModule, Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { createHttpLoggerParameters, type ApiObservabilityOptions } from './http-logger.options';

@Module({})
export class ObservabilityModule {
  public static register(options: ApiObservabilityOptions): DynamicModule {
    return {
      module: ObservabilityModule,
      imports: [
        LoggerModule.forRoot({
          forRoutes: [{ method: RequestMethod.ALL, path: '{*splat}' }],
          pinoHttp: createHttpLoggerParameters(options),
          renameContext: 'component',
        }),
      ],
    };
  }
}
