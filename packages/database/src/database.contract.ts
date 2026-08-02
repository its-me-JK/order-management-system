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
