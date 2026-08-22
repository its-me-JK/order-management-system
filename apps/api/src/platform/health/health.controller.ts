import { Controller, Get, UseFilters, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

import { DatabaseHealthIndicator } from './database-health.indicator';
import { OperationalHealthExceptionFilter } from './operational-health-exception.filter';
import { ApiLivenessOperation, ApiReadinessOperation } from './operational-health.openapi';

@ApiTags('Operational Health')
@Controller({
  path: 'health',
  version: VERSION_NEUTRAL,
})
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
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
    ]);
  }
}
