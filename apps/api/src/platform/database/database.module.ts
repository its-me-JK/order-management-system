import { type DynamicModule, Module } from '@nestjs/common';

import type { DatabaseRuntime } from '@oms/database';
import { getPrismaClient } from '@oms/database/prisma';

import { DatabaseShutdown } from './database.shutdown';
import { DATABASE_CLIENT, DATABASE_CONNECTION, DATABASE_RUNTIME } from './database.tokens';

export type DatabaseRuntimeFactory = () => DatabaseRuntime;

@Module({})
export class DatabaseModule {
  public static register(createRuntime: DatabaseRuntimeFactory): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE_RUNTIME,
          useFactory: createRuntime,
        },
        {
          inject: [DATABASE_RUNTIME],
          provide: DATABASE_CONNECTION,
          useFactory: (runtime: DatabaseRuntime): DatabaseRuntime['connection'] =>
            runtime.connection,
        },
        {
          inject: [DATABASE_RUNTIME],
          provide: DATABASE_CLIENT,
          useFactory: getPrismaClient,
        },
        DatabaseShutdown,
      ],
      exports: [DATABASE_CLIENT, DATABASE_CONNECTION],
    };
  }
}
