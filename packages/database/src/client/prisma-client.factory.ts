import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { PrismaClient } from '../generated/prisma/client';

export interface PrismaClientConnectionOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly connectTimeoutMilliseconds: number;
  readonly connectionLimit: number;
  readonly database: string;
  readonly host: string;
  readonly idleTimeoutSeconds: number;
  readonly password: string;
  readonly port: number;
  readonly user: string;
}

export function createPrismaClient(options: PrismaClientConnectionOptions): PrismaClient {
  const adapter = new PrismaMariaDb({
    acquireTimeout: options.acquireTimeoutMilliseconds,
    connectTimeout: options.connectTimeoutMilliseconds,
    connectionLimit: options.connectionLimit,
    database: options.database,
    host: options.host,
    idleTimeout: options.idleTimeoutSeconds,
    password: options.password,
    port: options.port,
    user: options.user,
  });

  return new PrismaClient({ adapter });
}
