import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import type { DatabaseConnection } from '@oms/database';

import { DATABASE_CONNECTION } from '../database/database.tokens';

@Injectable()
export class DatabaseHealthIndicator {
  public constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: DatabaseConnection,
    private readonly healthIndicators: HealthIndicatorService,
  ) {}

  public async check(): Promise<HealthIndicatorResult<'database'>> {
    const result = this.healthIndicators.check('database');

    try {
      await this.database.probe();
      return result.up();
    } catch {
      return result.down();
    }
  }
}
