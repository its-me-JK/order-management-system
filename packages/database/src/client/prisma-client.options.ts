import type { DatabaseConnectionOptions } from '../database.contract';
import { databaseConnectionBudget } from './database-connection-budget';

export interface PrismaMariaDbPoolOptions {
  readonly acquireTimeout: number;
  readonly connectTimeout: number;
  readonly connectionLimit: number;
  readonly database: string;
  readonly host: string;
  readonly idleTimeout: number;
  readonly minimumIdle: number;
  readonly password: string;
  readonly port: number;
  readonly resetAfterUse: boolean;
  readonly ssl?: Readonly<{
    ca?: string;
    minVersion: 'TLSv1.2';
    rejectUnauthorized: true;
  }>;
  readonly user: string;
}

export function toPrismaMariaDbPoolOptions(
  options: DatabaseConnectionOptions,
): PrismaMariaDbPoolOptions {
  const budget = databaseConnectionBudget(options);

  return {
    acquireTimeout: options.acquireTimeoutMilliseconds,
    connectTimeout: options.connectTimeoutMilliseconds,
    connectionLimit: budget.prismaConnectionLimit,
    database: options.database,
    host: options.host,
    idleTimeout: options.idleTimeoutSeconds,
    // mariadb 3.4.5 cannot create on demand with minimumIdle set to zero.
    // A socket timeout is intentionally omitted because it also expires this
    // retained idle connection; request and transaction deadlines belong at
    // their respective operation boundaries.
    minimumIdle: 1,
    password: options.password,
    port: options.port,
    resetAfterUse: true,
    ...(options.tls.enabled
      ? {
          ssl: {
            minVersion: 'TLSv1.2' as const,
            rejectUnauthorized: true,
            ...(options.tls.certificateAuthority === undefined
              ? {}
              : { ca: options.tls.certificateAuthority }),
          },
        }
      : {}),
    user: options.user,
  };
}
