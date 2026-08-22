import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { DatabaseHealthIndicator } from './database-health.indicator';

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
  @HealthCheck()
  public live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  public ready(): Promise<HealthCheckResult> {
    return this.health.check([
      (): ReturnType<DatabaseHealthIndicator['check']> => this.database.check(),
    ]);
  }
}
