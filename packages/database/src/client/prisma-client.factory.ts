import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import type { DatabaseConnectionOptions } from '../database.contract';
import { PrismaClient } from '../generated/prisma/client';
import { toPrismaMariaDbPoolOptions } from './prisma-client.options';

export function createPrismaClient(options: DatabaseConnectionOptions): PrismaClient {
  const adapter = new PrismaMariaDb(toPrismaMariaDbPoolOptions(options));

  return new PrismaClient({ adapter });
}
