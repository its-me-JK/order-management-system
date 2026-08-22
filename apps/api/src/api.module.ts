import { type DynamicModule, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import {
  DatabaseModule,
  type DatabaseConnectionFactory,
} from './platform/database/database.module';
import { DatabaseHealthIndicator } from './platform/health/database-health.indicator';
import { HealthController } from './platform/health/health.controller';
import type { ApiObservabilityOptions } from './platform/observability/http-logger.options';
import { ObservabilityModule } from './platform/observability/observability.module';

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
      providers: [DatabaseHealthIndicator],
    };
  }
}
