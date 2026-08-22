import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import {
  DatabaseModule,
  type DatabaseConnectionFactory,
} from './platform/database/database.module';
import { DatabaseHealthIndicator } from './platform/health/database-health.indicator';
import { HealthController } from './platform/health/health.controller';
import { OperationalHealthExceptionFilter } from './platform/health/operational-health-exception.filter';
import { ProblemDetailsFilter } from './platform/http-errors/problem-details.filter';
import { ProblemDetailsResponseWriter } from './platform/http-errors/problem-details.response-writer';
import type { ApiObservabilityOptions } from './platform/observability/http-logger.options';
import { ObservabilityModule } from './platform/observability/observability.module';
import { createApiValidationPipe } from './platform/validation/api-validation.pipe';

export interface ApiModuleOptions {
  readonly createDatabaseConnection: DatabaseConnectionFactory;
  readonly observability: ApiObservabilityOptions;
}

@Module({})
export class ApiModule {
  public static register(options: ApiModuleOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        ObservabilityModule.register(options.observability),
        DatabaseModule.register(options.createDatabaseConnection),
        TerminusModule.forRoot({ logger: false }),
      ],
      controllers: [HealthController],
      providers: [
        DatabaseHealthIndicator,
        OperationalHealthExceptionFilter,
        ProblemDetailsResponseWriter,
        {
          provide: APP_FILTER,
          useClass: ProblemDetailsFilter,
        },
        {
          provide: APP_PIPE,
          useFactory: createApiValidationPipe,
        },
      ],
    };
  }
}
