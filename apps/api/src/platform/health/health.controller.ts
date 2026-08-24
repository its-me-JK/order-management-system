import { Controller, Get, UseFilters, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

import { DatabaseHealthIndicator } from './database-health.indicator';
import { OperationalHealthExceptionFilter } from './operational-health-exception.filter';
import { ApiLivenessOperation, ApiReadinessOperation } from './operational-health.openapi';
import { RedisHealthIndicator } from './redis-health.indicator';

@ApiTags('Operational Health')
@Controller({
  path: 'health',
  version: VERSION_NEUTRAL,
})
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get('live')
  @ApiLivenessOperation()
  @HealthCheck({ noCache: true, swaggerDocumentation: false })
  @UseFilters(OperationalHealthExceptionFilter)
  public live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('ready')
  @ApiReadinessOperation()
  @HealthCheck({ noCache: true, swaggerDocumentation: false })
  @UseFilters(OperationalHealthExceptionFilter)
  public ready(): Promise<HealthCheckResult> {
    return this.health.check([
      (): ReturnType<DatabaseHealthIndicator['check']> => this.database.check(),
      (): ReturnType<RedisHealthIndicator['check']> => this.redis.check(),
    ]);
  }
}
