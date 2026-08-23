export type DatabaseTlsOptions =
  | Readonly<{
      enabled: false;
    }>
  | Readonly<{
      certificateAuthority?: string;
      enabled: true;
    }>;

export interface DatabaseConnectionOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly connectTimeoutMilliseconds: number;
  readonly connectionLimit: number;
  readonly transactionConnectionLimit: number;
  readonly database: string;
  readonly host: string;
  readonly idleTimeoutSeconds: number;
  readonly password: string;
  readonly port: number;
  readonly probeTimeoutMilliseconds: number;
  readonly tls: DatabaseTlsOptions;
  readonly user: string;
}

export interface DatabaseConnection {
  close(): Promise<void>;
  probe(): Promise<void>;
}

/**
 * Owns the process-wide database client and its lifecycle-facing connection.
 *
 * The concrete client is deliberately absent from this public contract. Only
 * infrastructure code may recover it through the `@oms/database/prisma`
 * entrypoint.
 */
export interface DatabaseRuntime {
  readonly connection: DatabaseConnection;
  close(): Promise<void>;
}
