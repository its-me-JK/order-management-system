import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import { AuthModule } from './features/auth/auth.module';
import { CatalogModule } from './features/catalog/catalog.module';
import { InventoryModule } from './features/inventory/inventory.module';
import { NotificationModule } from './features/notifications/notification.module';
import { OrderModule } from './features/orders/order.module';
import { DatabaseModule, type DatabaseRuntimeFactory } from './platform/database/database.module';
import { DemoDataSeed } from './platform/database/demo-data.seed';
import { DatabaseHealthIndicator } from './platform/health/database-health.indicator';
import { HealthController } from './platform/health/health.controller';
import { OperationalHealthExceptionFilter } from './platform/health/operational-health-exception.filter';
import { RedisHealthIndicator } from './platform/health/redis-health.indicator';
import { ProblemDetailsFilter } from './platform/http-errors/problem-details.filter';
import { ProblemDetailsResponseWriter } from './platform/http-errors/problem-details.response-writer';
import type { ApiObservabilityOptions } from './platform/observability/http-logger.options';
import { ObservabilityModule } from './platform/observability/observability.module';
import { RedisModule, type RedisRuntimeFactory } from './platform/redis/redis.module';
import { createApiValidationPipe } from './platform/validation/api-validation.pipe';

export interface ApiModuleOptions {
  readonly createDatabaseRuntime: DatabaseRuntimeFactory;
  readonly observability: ApiObservabilityOptions;
  readonly createRedisRuntime: RedisRuntimeFactory;
}

@Module({})
export class ApiModule {
  public static register(options: ApiModuleOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        ObservabilityModule.register(options.observability),
        DatabaseModule.register(options.createDatabaseRuntime),
        RedisModule.register(options.createRedisRuntime),
        TerminusModule.forRoot({ logger: false }),
        AuthModule,
        CatalogModule,
        InventoryModule,
        OrderModule,
        NotificationModule,
      ],
      controllers: [HealthController],
      providers: [
        DemoDataSeed,
        DatabaseHealthIndicator,
        RedisHealthIndicator,
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
