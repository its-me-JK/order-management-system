import { type DynamicModule, Module } from '@nestjs/common';

import type { DatabaseConnection } from '@oms/database';

import { DatabaseShutdown } from './database.shutdown';
import { DATABASE_CONNECTION } from './database.tokens';

export type DatabaseConnectionFactory = () => DatabaseConnection;

@Module({})
export class DatabaseModule {
  public static register(createConnection: DatabaseConnectionFactory): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE_CONNECTION,
          useFactory: createConnection,
        },
        DatabaseShutdown,
      ],
      exports: [DATABASE_CONNECTION],
    };
  }
}
