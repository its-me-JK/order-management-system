import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type { RedisRuntime } from '@oms/redis';

import { REDIS_RUNTIME } from '../redis/redis.tokens';

@Injectable()
export class RedisHealthIndicator {
  public constructor(
    @Inject(REDIS_RUNTIME)
    private readonly redis: RedisRuntime,
    private readonly healthIndicators: HealthIndicatorService,
  ) {}

  public async check(): Promise<HealthIndicatorResult<'redis'>> {
    const result = this.healthIndicators.check('redis');

    try {
      await this.redis.probe();
      return result.up();
    } catch {
      return result.down();
    }
  }
}
