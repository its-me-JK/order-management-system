import { X509Certificate } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { createSecureContext } from 'node:tls';

import { z } from 'zod';

import { InvalidConfigurationError, type RuntimeEnvironment } from './api-runtime.configuration';

const DEFAULT_DATABASE_PORT = 3306;
const DEFAULT_CONNECTION_LIMIT = 5;
const DEFAULT_CONNECT_TIMEOUT_MILLISECONDS = 5_000;
const DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_PROBE_TIMEOUT_MILLISECONDS = 1_000;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;

const databaseHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => !/[\s/?#]/u.test(value) && !value.includes('://'));
const databaseNameSchema = z.string().regex(/^[A-Za-z0-9_]{1,64}$/u);
const databaseUserSchema = z.string().regex(/^[A-Za-z0-9_]{1,32}$/u);
const secretValueSchema = z.string().min(1);
const secretFileSchema = z.string().min(1);

function boundedDecimalSchema(minimum: number, maximum: number): z.ZodType<number> {
  return z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
}

const databaseEnvironmentSchema = z.object({
  DATABASE_HOST: databaseHostSchema,
  DATABASE_PORT: boundedDecimalSchema(1, 65_535),
  DATABASE_NAME: databaseNameSchema,
  DATABASE_USER: databaseUserSchema,
  DATABASE_PASSWORD: secretValueSchema.optional(),
  DATABASE_PASSWORD_FILE: secretFileSchema.optional(),
  DATABASE_CONNECTION_LIMIT: boundedDecimalSchema(1, 50),
  DATABASE_CONNECT_TIMEOUT_MS: boundedDecimalSchema(100, 60_000),
  DATABASE_ACQUIRE_TIMEOUT_MS: boundedDecimalSchema(100, 60_000),
  DATABASE_PROBE_TIMEOUT_MS: boundedDecimalSchema(100, 5_000),
  DATABASE_IDLE_TIMEOUT_SECONDS: boundedDecimalSchema(1, 3_600),
  DATABASE_TLS_MODE: z.enum(['disabled', 'verify-identity']),
  DATABASE_TLS_CA: secretValueSchema.optional(),
  DATABASE_TLS_CA_FILE: secretFileSchema.optional(),
});

type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
type ConfigurationInput = Readonly<Record<string, string | undefined>>;

export type DatabasePasswordSource =
  | Readonly<{
      kind: 'value';
      value: string;
      variableName: 'DATABASE_PASSWORD';
    }>
  | Readonly<{
      kind: 'file';
      path: string;
      variableName: 'DATABASE_PASSWORD_FILE';
    }>;

export type DatabaseCertificateAuthoritySource =
  | Readonly<{
      kind: 'value';
      value: string;
      variableName: 'DATABASE_TLS_CA';
    }>
  | Readonly<{
      kind: 'file';
      path: string;
      variableName: 'DATABASE_TLS_CA_FILE';
    }>;

export type DatabaseTlsConfiguration =
  | Readonly<{ mode: 'disabled' }>
  | Readonly<{
      mode: 'verify-identity';
      certificateAuthority?: DatabaseCertificateAuthoritySource;
    }>;

export interface DatabaseRuntimeConfiguration {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: DatabasePasswordSource;
  readonly connectionLimit: number;
  readonly connectTimeoutMilliseconds: number;
  readonly acquireTimeoutMilliseconds: number;
  readonly probeTimeoutMilliseconds: number;
  readonly idleTimeoutSeconds: number;
  readonly tls: DatabaseTlsConfiguration;
}

export type ResolvedDatabaseTlsConfiguration =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      certificateAuthority?: string;
    }>;

export interface ResolvedDatabaseRuntimeConfiguration {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly connectionLimit: number;
  readonly connectTimeoutMilliseconds: number;
  readonly acquireTimeoutMilliseconds: number;
  readonly probeTimeoutMilliseconds: number;
  readonly idleTimeoutSeconds: number;
  readonly tls: ResolvedDatabaseTlsConfiguration;
}

export interface DatabaseSecretResolutionOptions {
  readonly baseDirectory: string;
  readonly readFile: (path: string) => string;
}

function withDefaults(
  environment: ConfigurationInput,
  runtimeEnvironment: RuntimeEnvironment,
): ConfigurationInput {
  const useLocalDefaults = runtimeEnvironment !== 'production';

  return {
    DATABASE_HOST: environment['DATABASE_HOST'] ?? (useLocalDefaults ? '127.0.0.1' : undefined),
    DATABASE_PORT: environment['DATABASE_PORT'] ?? String(DEFAULT_DATABASE_PORT),
    DATABASE_NAME: environment['DATABASE_NAME'] ?? (useLocalDefaults ? 'oms' : undefined),
    DATABASE_USER: environment['DATABASE_USER'] ?? (useLocalDefaults ? 'oms_app' : undefined),
    DATABASE_PASSWORD: environment['DATABASE_PASSWORD'],
    DATABASE_PASSWORD_FILE: environment['DATABASE_PASSWORD_FILE'],
    DATABASE_CONNECTION_LIMIT:
      environment['DATABASE_CONNECTION_LIMIT'] ?? String(DEFAULT_CONNECTION_LIMIT),
    DATABASE_CONNECT_TIMEOUT_MS:
      environment['DATABASE_CONNECT_TIMEOUT_MS'] ?? String(DEFAULT_CONNECT_TIMEOUT_MILLISECONDS),
    DATABASE_ACQUIRE_TIMEOUT_MS:
      environment['DATABASE_ACQUIRE_TIMEOUT_MS'] ?? String(DEFAULT_ACQUIRE_TIMEOUT_MILLISECONDS),
    DATABASE_PROBE_TIMEOUT_MS:
      environment['DATABASE_PROBE_TIMEOUT_MS'] ?? String(DEFAULT_PROBE_TIMEOUT_MILLISECONDS),
    DATABASE_IDLE_TIMEOUT_SECONDS:
      environment['DATABASE_IDLE_TIMEOUT_SECONDS'] ?? String(DEFAULT_IDLE_TIMEOUT_SECONDS),
    DATABASE_TLS_MODE:
      environment['DATABASE_TLS_MODE'] ?? (useLocalDefaults ? 'disabled' : undefined),
    DATABASE_TLS_CA: environment['DATABASE_TLS_CA'],
    DATABASE_TLS_CA_FILE: environment['DATABASE_TLS_CA_FILE'],
  };
}

function addCrossFieldErrors(
  environment: ConfigurationInput,
  parsedEnvironment: DatabaseEnvironment | undefined,
  runtimeEnvironment: RuntimeEnvironment,
  invalidVariables: Set<string>,
): void {
  const hasPassword = environment['DATABASE_PASSWORD'] !== undefined;
  const hasPasswordFile = environment['DATABASE_PASSWORD_FILE'] !== undefined;

  if (hasPassword === hasPasswordFile) {
    invalidVariables.add('DATABASE_PASSWORD');
    invalidVariables.add('DATABASE_PASSWORD_FILE');
  }

  const hasCertificateAuthority = environment['DATABASE_TLS_CA'] !== undefined;
  const hasCertificateAuthorityFile = environment['DATABASE_TLS_CA_FILE'] !== undefined;

  if (hasCertificateAuthority && hasCertificateAuthorityFile) {
    invalidVariables.add('DATABASE_TLS_CA');
    invalidVariables.add('DATABASE_TLS_CA_FILE');
  }

  const tlsMode = environment['DATABASE_TLS_MODE'];
  const verifiedTls = tlsMode === 'verify-identity';

  if ((hasCertificateAuthority || hasCertificateAuthorityFile) && !verifiedTls) {
    invalidVariables.add('DATABASE_TLS_MODE');

    if (hasCertificateAuthority) {
      invalidVariables.add('DATABASE_TLS_CA');
    }

    if (hasCertificateAuthorityFile) {
      invalidVariables.add('DATABASE_TLS_CA_FILE');
    }
  }

  if (runtimeEnvironment === 'production' && !verifiedTls) {
    invalidVariables.add('DATABASE_TLS_MODE');
  }

  const connectTimeout = boundedDecimalSchema(100, 60_000).safeParse(
    environment['DATABASE_CONNECT_TIMEOUT_MS'],
  );
  const acquireTimeout = boundedDecimalSchema(100, 60_000).safeParse(
    environment['DATABASE_ACQUIRE_TIMEOUT_MS'],
  );
  if (
    connectTimeout.success &&
    acquireTimeout.success &&
    connectTimeout.data > acquireTimeout.data
  ) {
    invalidVariables.add('DATABASE_CONNECT_TIMEOUT_MS');
    invalidVariables.add('DATABASE_ACQUIRE_TIMEOUT_MS');
  }

  if (
    parsedEnvironment !== undefined &&
    parsedEnvironment.DATABASE_CONNECT_TIMEOUT_MS > parsedEnvironment.DATABASE_ACQUIRE_TIMEOUT_MS
  ) {
    invalidVariables.add('DATABASE_CONNECT_TIMEOUT_MS');
    invalidVariables.add('DATABASE_ACQUIRE_TIMEOUT_MS');
  }
}

function passwordSource(environment: DatabaseEnvironment): DatabasePasswordSource {
  if (environment.DATABASE_PASSWORD !== undefined) {
    return Object.freeze({
      kind: 'value',
      value: environment.DATABASE_PASSWORD,
      variableName: 'DATABASE_PASSWORD',
    });
  }

  if (environment.DATABASE_PASSWORD_FILE === undefined) {
    throw new InvalidConfigurationError(['DATABASE_PASSWORD', 'DATABASE_PASSWORD_FILE']);
  }

  return Object.freeze({
    kind: 'file',
    path: environment.DATABASE_PASSWORD_FILE,
    variableName: 'DATABASE_PASSWORD_FILE',
  });
}

function certificateAuthoritySource(
  environment: DatabaseEnvironment,
): DatabaseCertificateAuthoritySource | undefined {
  if (environment.DATABASE_TLS_CA !== undefined) {
    return Object.freeze({
      kind: 'value',
      value: environment.DATABASE_TLS_CA,
      variableName: 'DATABASE_TLS_CA',
    });
  }

  if (environment.DATABASE_TLS_CA_FILE !== undefined) {
    return Object.freeze({
      kind: 'file',
      path: environment.DATABASE_TLS_CA_FILE,
      variableName: 'DATABASE_TLS_CA_FILE',
    });
  }

  return undefined;
}

function tlsConfiguration(environment: DatabaseEnvironment): DatabaseTlsConfiguration {
  if (environment.DATABASE_TLS_MODE === 'disabled') {
    return Object.freeze({ mode: 'disabled' });
  }

  const certificateAuthority = certificateAuthoritySource(environment);

  return Object.freeze({
    mode: 'verify-identity',
    ...(certificateAuthority === undefined ? {} : { certificateAuthority }),
  });
}

export function parseDatabaseRuntimeConfiguration(
  environment: ConfigurationInput,
  runtimeEnvironment: RuntimeEnvironment,
): DatabaseRuntimeConfiguration {
  const environmentWithDefaults = withDefaults(environment, runtimeEnvironment);
  const result = databaseEnvironmentSchema.safeParse(environmentWithDefaults);
  const invalidVariables = new Set<string>();

  if (!result.success) {
    for (const issue of result.error.issues) {
      invalidVariables.add(String(issue.path[0]));
    }
  }

  addCrossFieldErrors(
    environmentWithDefaults,
    result.success ? result.data : undefined,
    runtimeEnvironment,
    invalidVariables,
  );

  if (!result.success || invalidVariables.size > 0) {
    throw new InvalidConfigurationError([...invalidVariables]);
  }

  return Object.freeze({
    host: result.data.DATABASE_HOST,
    port: result.data.DATABASE_PORT,
    database: result.data.DATABASE_NAME,
    user: result.data.DATABASE_USER,
    password: passwordSource(result.data),
    connectionLimit: result.data.DATABASE_CONNECTION_LIMIT,
    connectTimeoutMilliseconds: result.data.DATABASE_CONNECT_TIMEOUT_MS,
    acquireTimeoutMilliseconds: result.data.DATABASE_ACQUIRE_TIMEOUT_MS,
    probeTimeoutMilliseconds: result.data.DATABASE_PROBE_TIMEOUT_MS,
    idleTimeoutSeconds: result.data.DATABASE_IDLE_TIMEOUT_SECONDS,
    tls: tlsConfiguration(result.data),
  });
}

type ResolvableSecretSource = DatabasePasswordSource | DatabaseCertificateAuthoritySource;

function removeOneTerminalNewline(value: string): string {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }

  if (value.endsWith('\n')) {
    return value.slice(0, -1);
  }

  return value;
}

function tryResolveSecret(
  source: ResolvableSecretSource,
  options: DatabaseSecretResolutionOptions,
): Readonly<{ value?: string; invalidVariable?: string }> {
  if (source.kind === 'value') {
    return { value: source.value };
  }

  try {
    const value = removeOneTerminalNewline(
      options.readFile(resolve(options.baseDirectory, source.path)),
    );

    return value === '' ? { invalidVariable: source.variableName } : { value };
  } catch {
    return { invalidVariable: source.variableName };
  }
}

function isValidCertificateAuthority(value: string): boolean {
  try {
    const certificatePattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu;
    const certificates = value.match(certificatePattern);

    if (certificates === null || value.replace(certificatePattern, '').trim() !== '') {
      return false;
    }

    for (const certificate of certificates) {
      if (new X509Certificate(certificate).raw.length === 0) {
        return false;
      }
    }

    createSecureContext({ ca: value });
    return true;
  } catch {
    return false;
  }
}

export function resolveDatabaseRuntimeConfiguration(
  configuration: DatabaseRuntimeConfiguration,
  options: DatabaseSecretResolutionOptions,
): ResolvedDatabaseRuntimeConfiguration {
  if (!isAbsolute(options.baseDirectory)) {
    throw new TypeError('Database secret base directory must be absolute');
  }

  const invalidVariables = new Set<string>();
  const resolvedPassword = tryResolveSecret(configuration.password, options);

  if (resolvedPassword.invalidVariable !== undefined) {
    invalidVariables.add(resolvedPassword.invalidVariable);
  }

  let resolvedCertificateAuthority: string | undefined;

  if (
    configuration.tls.mode === 'verify-identity' &&
    configuration.tls.certificateAuthority !== undefined
  ) {
    const certificateAuthoritySource = configuration.tls.certificateAuthority;
    const certificateAuthority = tryResolveSecret(certificateAuthoritySource, options);

    if (
      certificateAuthority.invalidVariable !== undefined ||
      certificateAuthority.value === undefined ||
      !isValidCertificateAuthority(certificateAuthority.value)
    ) {
      invalidVariables.add(certificateAuthoritySource.variableName);
    } else {
      resolvedCertificateAuthority = certificateAuthority.value;
    }
  }

  if (invalidVariables.size > 0 || resolvedPassword.value === undefined) {
    throw new InvalidConfigurationError([...invalidVariables]);
  }

  const tls: ResolvedDatabaseTlsConfiguration =
    configuration.tls.mode === 'disabled'
      ? Object.freeze({ enabled: false })
      : Object.freeze({
          enabled: true,
          ...(resolvedCertificateAuthority === undefined
            ? {}
            : { certificateAuthority: resolvedCertificateAuthority }),
        });

  return Object.freeze({
    host: configuration.host,
    port: configuration.port,
    database: configuration.database,
    user: configuration.user,
    password: resolvedPassword.value,
    connectionLimit: configuration.connectionLimit,
    connectTimeoutMilliseconds: configuration.connectTimeoutMilliseconds,
    acquireTimeoutMilliseconds: configuration.acquireTimeoutMilliseconds,
    probeTimeoutMilliseconds: configuration.probeTimeoutMilliseconds,
    idleTimeoutSeconds: configuration.idleTimeoutSeconds,
    tls,
  });
}
