import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import type { DatabaseConnection } from '@oms/database';

import { DATABASE_CONNECTION } from './database.tokens';

@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  public constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: DatabaseConnection,
  ) {}

  public onApplicationShutdown(): Promise<void> {
    return this.database.close();
  }
}
