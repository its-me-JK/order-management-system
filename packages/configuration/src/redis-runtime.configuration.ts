import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { createSecureContext } from 'node:tls';

import { z } from 'zod';

import { type DeploymentEnvironment, InvalidConfigurationError } from './api-runtime.configuration';

const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_CONNECT_TIMEOUT_MILLISECONDS = 500;
const DEFAULT_COMMAND_TIMEOUT_MILLISECONDS = 100;
const DEFAULT_PROBE_TIMEOUT_MILLISECONDS = 500;
const DEFAULT_SHUTDOWN_TIMEOUT_MILLISECONDS = 1_000;
const DEFAULT_COMMAND_QUEUE_LIMIT = 256;
const MAX_REDIS_USERNAME_BYTES = 128;
const MAX_REDIS_PASSWORD_BYTES = 8_192;
const MAX_REDIS_CERTIFICATE_AUTHORITY_BYTES = 1_048_576;
const MAX_TERMINAL_LINE_ENDING_BYTES = 2;
const OVERSIZE_SENTINEL_BYTES = 1;

const redisHostSchema = z.string().refine(isValidRedisHost);

function hasCanonicalUtf8WithinByteLimit(
  value: string,
  minimumBytes: number,
  maximumBytes: number,
): boolean {
  const bytes = Buffer.from(value, 'utf8');

  return (
    bytes.length >= minimumBytes && bytes.length <= maximumBytes && bytes.toString('utf8') === value
  );
}

function isValidRedisHost(value: string): boolean {
  if (!hasCanonicalUtf8WithinByteLimit(value, 1, 253)) {
    return false;
  }

  if (isIP(value) !== 0) {
    return true;
  }

  if (value.split('.').every((component) => /^(?:0[xX][0-9A-Fa-f]+|[0-9]+)$/u.test(component))) {
    return false;
  }

  const labels = value.split('.');

  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
  );
}

const redisUsernameSchema = z
  .string()
  .refine(
    (value) =>
      hasCanonicalUtf8WithinByteLimit(value, 1, MAX_REDIS_USERNAME_BYTES) &&
      !/[\s\p{Cc}]/u.test(value),
  );
const redisPasswordValueSchema = z
  .string()
  .refine((value) => hasCanonicalUtf8WithinByteLimit(value, 1, MAX_REDIS_PASSWORD_BYTES));
const redisCertificateAuthorityValueSchema = z
  .string()
  .refine((value) =>
    hasCanonicalUtf8WithinByteLimit(value, 1, MAX_REDIS_CERTIFICATE_AUTHORITY_BYTES),
  );
const secretFileSchema = z.string().min(1);

function boundedDecimalSchema(minimum: number, maximum: number): z.ZodType<number> {
  return z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
}

const redisEnvironmentSchema = z.object({
  REDIS_HOST: redisHostSchema,
  REDIS_PORT: boundedDecimalSchema(1, 65_535),
  REDIS_USERNAME: redisUsernameSchema.optional(),
  REDIS_PASSWORD: redisPasswordValueSchema.optional(),
  REDIS_PASSWORD_FILE: secretFileSchema.optional(),
  REDIS_CONNECT_TIMEOUT_MS: boundedDecimalSchema(100, 5_000),
  REDIS_COMMAND_TIMEOUT_MS: boundedDecimalSchema(25, 500),
  REDIS_PROBE_TIMEOUT_MS: boundedDecimalSchema(25, 5_000),
  REDIS_SHUTDOWN_TIMEOUT_MS: boundedDecimalSchema(100, 10_000),
  REDIS_COMMAND_QUEUE_LIMIT: boundedDecimalSchema(1, 10_000),
  REDIS_TLS_MODE: z.enum(['disabled', 'verify-identity']),
  REDIS_TLS_CA: redisCertificateAuthorityValueSchema.optional(),
  REDIS_TLS_CA_FILE: secretFileSchema.optional(),
});

type RedisEnvironment = z.infer<typeof redisEnvironmentSchema>;
type ConfigurationInput = Readonly<Record<string, string | undefined>>;

export type RedisPasswordSource =
  | Readonly<{
      kind: 'value';
      value: string;
      variableName: 'REDIS_PASSWORD';
    }>
  | Readonly<{
      kind: 'file';
      path: string;
      variableName: 'REDIS_PASSWORD_FILE';
    }>;

export type RedisCertificateAuthoritySource =
  | Readonly<{
      kind: 'value';
      value: string;
      variableName: 'REDIS_TLS_CA';
    }>
  | Readonly<{
      kind: 'file';
      path: string;
      variableName: 'REDIS_TLS_CA_FILE';
    }>;

export type RedisTlsConfiguration =
  | Readonly<{ mode: 'disabled' }>
  | Readonly<{
      mode: 'verify-identity';
      certificateAuthority?: RedisCertificateAuthoritySource;
    }>;

export interface RedisRuntimeConfiguration {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: RedisPasswordSource;
  readonly connectTimeoutMilliseconds: number;
  readonly commandTimeoutMilliseconds: number;
  readonly probeTimeoutMilliseconds: number;
  readonly shutdownTimeoutMilliseconds: number;
  readonly commandQueueLimit: number;
  readonly tls: RedisTlsConfiguration;
}

export type ResolvedRedisTlsConfiguration =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      certificateAuthority?: string;
    }>;

export interface ResolvedRedisRuntimeConfiguration {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly connectTimeoutMilliseconds: number;
  readonly commandTimeoutMilliseconds: number;
  readonly probeTimeoutMilliseconds: number;
  readonly shutdownTimeoutMilliseconds: number;
  readonly commandQueueLimit: number;
  readonly tls: ResolvedRedisTlsConfiguration;
}

export interface RedisSecretResolutionOptions {
  readonly baseDirectory: string;
  /** Reads at most the requested bytes, including the oversize sentinel byte. */
  readonly readFile: (path: string, maximumBytes: number) => Uint8Array;
}

function withDefaults(
  environment: ConfigurationInput,
  deploymentEnvironment: DeploymentEnvironment,
): ConfigurationInput {
  const useLocalDefaults = deploymentEnvironment === 'local' || deploymentEnvironment === 'test';

  return {
    REDIS_HOST: environment['REDIS_HOST'] ?? (useLocalDefaults ? '127.0.0.1' : undefined),
    REDIS_PORT: environment['REDIS_PORT'] ?? String(DEFAULT_REDIS_PORT),
    REDIS_USERNAME: environment['REDIS_USERNAME'] ?? (useLocalDefaults ? 'oms_app' : undefined),
    REDIS_PASSWORD: environment['REDIS_PASSWORD'],
    REDIS_PASSWORD_FILE: environment['REDIS_PASSWORD_FILE'],
    REDIS_CONNECT_TIMEOUT_MS:
      environment['REDIS_CONNECT_TIMEOUT_MS'] ?? String(DEFAULT_CONNECT_TIMEOUT_MILLISECONDS),
    REDIS_COMMAND_TIMEOUT_MS:
      environment['REDIS_COMMAND_TIMEOUT_MS'] ?? String(DEFAULT_COMMAND_TIMEOUT_MILLISECONDS),
    REDIS_PROBE_TIMEOUT_MS:
      environment['REDIS_PROBE_TIMEOUT_MS'] ?? String(DEFAULT_PROBE_TIMEOUT_MILLISECONDS),
    REDIS_SHUTDOWN_TIMEOUT_MS:
      environment['REDIS_SHUTDOWN_TIMEOUT_MS'] ?? String(DEFAULT_SHUTDOWN_TIMEOUT_MILLISECONDS),
    REDIS_COMMAND_QUEUE_LIMIT:
      environment['REDIS_COMMAND_QUEUE_LIMIT'] ?? String(DEFAULT_COMMAND_QUEUE_LIMIT),
    REDIS_TLS_MODE: environment['REDIS_TLS_MODE'] ?? (useLocalDefaults ? 'disabled' : undefined),
    REDIS_TLS_CA: environment['REDIS_TLS_CA'],
    REDIS_TLS_CA_FILE: environment['REDIS_TLS_CA_FILE'],
  };
}

function addCrossFieldErrors(
  environment: ConfigurationInput,
  deploymentEnvironment: DeploymentEnvironment,
  invalidVariables: Set<string>,
): void {
  const hasPassword = environment['REDIS_PASSWORD'] !== undefined;
  const hasPasswordFile = environment['REDIS_PASSWORD_FILE'] !== undefined;

  if (hasPassword === hasPasswordFile) {
    invalidVariables.add('REDIS_PASSWORD');
    invalidVariables.add('REDIS_PASSWORD_FILE');
  }

  const hasCertificateAuthority = environment['REDIS_TLS_CA'] !== undefined;
  const hasCertificateAuthorityFile = environment['REDIS_TLS_CA_FILE'] !== undefined;

  if (hasCertificateAuthority && hasCertificateAuthorityFile) {
    invalidVariables.add('REDIS_TLS_CA');
    invalidVariables.add('REDIS_TLS_CA_FILE');
  }

  const verifiedTls = environment['REDIS_TLS_MODE'] === 'verify-identity';

  if ((hasCertificateAuthority || hasCertificateAuthorityFile) && !verifiedTls) {
    invalidVariables.add('REDIS_TLS_MODE');

    if (hasCertificateAuthority) {
      invalidVariables.add('REDIS_TLS_CA');
    }

    if (hasCertificateAuthorityFile) {
      invalidVariables.add('REDIS_TLS_CA_FILE');
    }
  }

  const requiresDeployedSecurity = !['local', 'test'].includes(deploymentEnvironment);

  if (requiresDeployedSecurity && !verifiedTls) {
    invalidVariables.add('REDIS_TLS_MODE');
  }

  if (requiresDeployedSecurity && environment['REDIS_USERNAME'] === undefined) {
    invalidVariables.add('REDIS_USERNAME');
  }
}

function passwordSource(environment: RedisEnvironment): RedisPasswordSource {
  if (environment.REDIS_PASSWORD !== undefined) {
    return Object.freeze({
      kind: 'value',
      value: environment.REDIS_PASSWORD,
      variableName: 'REDIS_PASSWORD',
    });
  }

  if (environment.REDIS_PASSWORD_FILE === undefined) {
    throw new InvalidConfigurationError(['REDIS_PASSWORD', 'REDIS_PASSWORD_FILE']);
  }

  return Object.freeze({
    kind: 'file',
    path: environment.REDIS_PASSWORD_FILE,
    variableName: 'REDIS_PASSWORD_FILE',
  });
}

function certificateAuthoritySource(
  environment: RedisEnvironment,
): RedisCertificateAuthoritySource | undefined {
  if (environment.REDIS_TLS_CA !== undefined) {
    return Object.freeze({
      kind: 'value',
      value: environment.REDIS_TLS_CA,
      variableName: 'REDIS_TLS_CA',
    });
  }

  if (environment.REDIS_TLS_CA_FILE !== undefined) {
    return Object.freeze({
      kind: 'file',
      path: environment.REDIS_TLS_CA_FILE,
      variableName: 'REDIS_TLS_CA_FILE',
    });
  }

  return undefined;
}

function tlsConfiguration(environment: RedisEnvironment): RedisTlsConfiguration {
  if (environment.REDIS_TLS_MODE === 'disabled') {
    return Object.freeze({ mode: 'disabled' });
  }

  const certificateAuthority = certificateAuthoritySource(environment);

  return Object.freeze({
    mode: 'verify-identity',
    ...(certificateAuthority === undefined ? {} : { certificateAuthority }),
  });
}

export function parseRedisRuntimeConfiguration(
  environment: ConfigurationInput,
  deploymentEnvironment: DeploymentEnvironment,
): RedisRuntimeConfiguration {
  const environmentWithDefaults = withDefaults(environment, deploymentEnvironment);
  const result = redisEnvironmentSchema.safeParse(environmentWithDefaults);
  const invalidVariables = new Set<string>();

  if (!result.success) {
    for (const issue of result.error.issues) {
      invalidVariables.add(String(issue.path[0]));
    }
  }

  addCrossFieldErrors(environmentWithDefaults, deploymentEnvironment, invalidVariables);

  if (!result.success || invalidVariables.size > 0) {
    throw new InvalidConfigurationError([...invalidVariables]);
  }

  const username = result.data.REDIS_USERNAME;

  if (username === undefined) {
    throw new InvalidConfigurationError(['REDIS_USERNAME']);
  }

  return Object.freeze({
    host: result.data.REDIS_HOST,
    port: result.data.REDIS_PORT,
    username,
    password: passwordSource(result.data),
    connectTimeoutMilliseconds: result.data.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeoutMilliseconds: result.data.REDIS_COMMAND_TIMEOUT_MS,
    probeTimeoutMilliseconds: result.data.REDIS_PROBE_TIMEOUT_MS,
    shutdownTimeoutMilliseconds: result.data.REDIS_SHUTDOWN_TIMEOUT_MS,
    commandQueueLimit: result.data.REDIS_COMMAND_QUEUE_LIMIT,
    tls: tlsConfiguration(result.data),
  });
}

type ResolvableSecretSource = RedisPasswordSource | RedisCertificateAuthoritySource;

function removeOneTerminalNewline(value: Uint8Array): Uint8Array {
  let end = value.length;

  if (end > 0 && value[end - 1] === 0x0a) {
    end -= 1;

    if (end > 0 && value[end - 1] === 0x0d) {
      end -= 1;
    }
  }

  return value.subarray(0, end);
}

function decodeCanonicalUtf8(value: Uint8Array): string | undefined {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);

    return Buffer.from(decoded, 'utf8').equals(value) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function tryResolveSecret(
  source: ResolvableSecretSource,
  options: RedisSecretResolutionOptions,
  maximumBytes: number,
): Readonly<{ value?: string; invalidVariable?: string }> {
  if (source.kind === 'value') {
    return hasCanonicalUtf8WithinByteLimit(source.value, 1, maximumBytes)
      ? { value: source.value }
      : { invalidVariable: source.variableName };
  }

  try {
    const maximumFileBytes =
      maximumBytes + MAX_TERMINAL_LINE_ENDING_BYTES + OVERSIZE_SENTINEL_BYTES;
    const fileBytes = options.readFile(
      resolve(options.baseDirectory, source.path),
      maximumFileBytes,
    );
    const maximumValidFileBytes = maximumBytes + MAX_TERMINAL_LINE_ENDING_BYTES;

    if (!(fileBytes instanceof Uint8Array) || fileBytes.byteLength > maximumValidFileBytes) {
      return { invalidVariable: source.variableName };
    }

    const valueBytes = removeOneTerminalNewline(Buffer.from(fileBytes));

    if (valueBytes.length === 0 || valueBytes.length > maximumBytes) {
      return { invalidVariable: source.variableName };
    }

    const value = decodeCanonicalUtf8(valueBytes);

    return value === undefined ? { invalidVariable: source.variableName } : { value };
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

export function resolveRedisRuntimeConfiguration(
  configuration: RedisRuntimeConfiguration,
  options: RedisSecretResolutionOptions,
): ResolvedRedisRuntimeConfiguration {
  if (!isAbsolute(options.baseDirectory)) {
    throw new TypeError('Redis secret base directory must be absolute');
  }

  const invalidVariables = new Set<string>();
  const resolvedPassword = tryResolveSecret(
    configuration.password,
    options,
    MAX_REDIS_PASSWORD_BYTES,
  );

  if (resolvedPassword.invalidVariable !== undefined) {
    invalidVariables.add(resolvedPassword.invalidVariable);
  }

  let resolvedCertificateAuthority: string | undefined;

  if (
    configuration.tls.mode === 'verify-identity' &&
    configuration.tls.certificateAuthority !== undefined
  ) {
    const certificateAuthoritySource = configuration.tls.certificateAuthority;
    const certificateAuthority = tryResolveSecret(
      certificateAuthoritySource,
      options,
      MAX_REDIS_CERTIFICATE_AUTHORITY_BYTES,
    );

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

  const tls: ResolvedRedisTlsConfiguration =
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
    username: configuration.username,
    password: resolvedPassword.value,
    connectTimeoutMilliseconds: configuration.connectTimeoutMilliseconds,
    commandTimeoutMilliseconds: configuration.commandTimeoutMilliseconds,
    probeTimeoutMilliseconds: configuration.probeTimeoutMilliseconds,
    shutdownTimeoutMilliseconds: configuration.shutdownTimeoutMilliseconds,
    commandQueueLimit: configuration.commandQueueLimit,
    tls,
  });
}
