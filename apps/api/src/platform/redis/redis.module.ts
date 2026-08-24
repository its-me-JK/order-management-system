import {
  Global,
  Inject,
  Injectable,
  type DynamicModule,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { RedisRuntime } from '@oms/redis';

import { REDIS_RUNTIME } from './redis.tokens';

export type RedisRuntimeFactory = () => RedisRuntime;

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  public constructor(@Inject(REDIS_RUNTIME) private readonly runtime: RedisRuntime) {}

  public onApplicationShutdown(): Promise<void> {
    return this.runtime.close();
  }
}

@Global()
@Module({})
export class RedisModule {
  public static register(createRuntime: RedisRuntimeFactory): DynamicModule {
    return {
      exports: [REDIS_RUNTIME],
      global: true,
      module: RedisModule,
      providers: [{ provide: REDIS_RUNTIME, useFactory: createRuntime }, RedisShutdown],
    };
  }
}
