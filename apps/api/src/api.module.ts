import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { GetPublicSku, ListPublicSkus, type CatalogReadRepository } from '@oms/catalog';
import { PrismaCatalogReadRepository } from '@oms/catalog/infrastructure/prisma';
import type { PrismaClient } from '@oms/database/prisma';

import { CatalogPublicSkuController } from './features/catalog/delivery/http/catalog-public-sku.controller';
import { DatabaseModule, type DatabaseRuntimeFactory } from './platform/database/database.module';
import { DATABASE_CLIENT } from './platform/database/database.tokens';
import { DatabaseHealthIndicator } from './platform/health/database-health.indicator';
import { HealthController } from './platform/health/health.controller';
import { OperationalHealthExceptionFilter } from './platform/health/operational-health-exception.filter';
import { ProblemDetailsFilter } from './platform/http-errors/problem-details.filter';
import { ProblemDetailsResponseWriter } from './platform/http-errors/problem-details.response-writer';
import type { ApiObservabilityOptions } from './platform/observability/http-logger.options';
import { ObservabilityModule } from './platform/observability/observability.module';
import { createApiValidationPipe } from './platform/validation/api-validation.pipe';

export interface ApiModuleOptions {
  readonly createDatabaseRuntime: DatabaseRuntimeFactory;
  readonly observability: ApiObservabilityOptions;
}

const CATALOG_READ_REPOSITORY = Symbol('CATALOG_READ_REPOSITORY');

@Module({})
export class ApiModule {
  public static register(options: ApiModuleOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        ObservabilityModule.register(options.observability),
        DatabaseModule.register(options.createDatabaseRuntime),
        TerminusModule.forRoot({ logger: false }),
      ],
      controllers: [CatalogPublicSkuController, HealthController],
      providers: [
        {
          inject: [DATABASE_CLIENT],
          provide: CATALOG_READ_REPOSITORY,
          useFactory: (client: PrismaClient): CatalogReadRepository =>
            new PrismaCatalogReadRepository(client),
        },
        {
          inject: [CATALOG_READ_REPOSITORY],
          provide: GetPublicSku,
          useFactory: (repository: CatalogReadRepository): GetPublicSku =>
            new GetPublicSku(repository),
        },
        {
          inject: [CATALOG_READ_REPOSITORY],
          provide: ListPublicSkus,
          useFactory: (repository: CatalogReadRepository): ListPublicSkus =>
            new ListPublicSkus(repository),
        },
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
