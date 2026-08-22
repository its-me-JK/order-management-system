import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import type { DatabaseRuntime } from '@oms/database';

import { DATABASE_RUNTIME } from './database.tokens';

@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly runtime: DatabaseRuntime,
  ) {}

  public onApplicationShutdown(): Promise<void> {
    return this.runtime.close();
  }
}
