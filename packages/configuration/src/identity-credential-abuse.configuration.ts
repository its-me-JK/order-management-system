import { isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

import { type DeploymentEnvironment, InvalidConfigurationError } from './api-runtime.configuration';

const DEFAULT_IDENTITY_CREDENTIAL_ABUSE_EPOCH = 'v1';
const DEFAULT_REFRESH_DEPLOYMENT_CAPACITY = 300;
const DEFAULT_REFRESH_DEPLOYMENT_REFILL_INTERVAL_MICROSECONDS = 200_000;
const DEFAULT_REFRESH_NETWORK_CAPACITY = 120;
const DEFAULT_REFRESH_NETWORK_REFILL_INTERVAL_MICROSECONDS = 2_500_000;
const DEFAULT_REFRESH_PRESENTED_CREDENTIAL_CAPACITY = 3;
const DEFAULT_REFRESH_PRESENTED_CREDENTIAL_REFILL_INTERVAL_MICROSECONDS = 100_000_000;
const MINIMUM_BUCKET_CAPACITY = 1;
const MAXIMUM_BUCKET_CAPACITY = 10_000;
const MINIMUM_REFILL_INTERVAL_MICROSECONDS = 1_000;
const MAXIMUM_REFILL_INTERVAL_MICROSECONDS = 180_000_000;
const MAXIMUM_BUCKET_REFILL_HORIZON_MICROSECONDS = 3_600_000_000;
const IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_HEX_LENGTH = 64;
const MAXIMUM_TERMINAL_LINE_ENDING_BYTES = 2;
const OVERSIZE_SENTINEL_BYTES = 1;
const DEPLOYMENT_SCOPE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const EPOCH_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/u;
const HMAC_SECRET_PATTERN = /^[0-9a-f]{64}$/u;

type ConfigurationInput = Readonly<Record<string, string | undefined>>;

const secretFileSchema = z.string().min(1);
const deploymentScopeSchema = z.string().regex(DEPLOYMENT_SCOPE_PATTERN);
const epochSchema = z.string().regex(EPOCH_PATTERN);
const hmacSecretSchema = z.string().regex(HMAC_SECRET_PATTERN);

function boundedDecimalSchema(minimum: number, maximum: number): z.ZodType<number> {
  return z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
}

const capacitySchema = boundedDecimalSchema(MINIMUM_BUCKET_CAPACITY, MAXIMUM_BUCKET_CAPACITY);
const refillIntervalSchema = boundedDecimalSchema(
  MINIMUM_REFILL_INTERVAL_MICROSECONDS,
  MAXIMUM_REFILL_INTERVAL_MICROSECONDS,
);

const identityCredentialAbuseEnvironmentSchema = z.object({
  IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: hmacSecretSchema.optional(),
  IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: secretFileSchema.optional(),
  IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE: deploymentScopeSchema,
  IDENTITY_CREDENTIAL_ABUSE_EPOCH: epochSchema,
  IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY: capacitySchema,
  IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US: refillIntervalSchema,
  IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY: capacitySchema,
  IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US: refillIntervalSchema,
  IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY: capacitySchema,
  IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US: refillIntervalSchema,
});

type IdentityCredentialAbuseEnvironment = z.infer<typeof identityCredentialAbuseEnvironmentSchema>;

export type IdentityCredentialAbuseHmacSecretSource =
  | Readonly<{
      kind: 'value';
      value: string;
      variableName: 'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET';
    }>
  | Readonly<{
      kind: 'file';
      path: string;
      variableName: 'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE';
    }>;

export interface IdentityCredentialAbuseBucketPolicy {
  readonly capacity: number;
  readonly refillIntervalMicroseconds: number;
}

export interface IdentityCredentialAbuseRefreshPolicy {
  readonly deployment: IdentityCredentialAbuseBucketPolicy;
  readonly network: IdentityCredentialAbuseBucketPolicy;
  readonly presentedCredential: IdentityCredentialAbuseBucketPolicy;
}

export interface IdentityCredentialAbuseConfiguration {
  readonly deploymentScope: string;
  readonly epoch: string;
  readonly hmacSecret: IdentityCredentialAbuseHmacSecretSource;
  readonly refresh: IdentityCredentialAbuseRefreshPolicy;
}

export interface ResolvedIdentityCredentialAbuseConfiguration {
  readonly deploymentScope: string;
  readonly epoch: string;
  /** Canonical lowercase hex encoding of exactly 32 secret bytes. */
  readonly hmacSecret: string;
  readonly refresh: IdentityCredentialAbuseRefreshPolicy;
}

export interface IdentityCredentialAbuseSecretResolutionOptions {
  readonly baseDirectory: string;
  /** Reads at most the requested bytes, including the oversize sentinel byte. */
  readonly readFile: (path: string, maximumBytes: number) => Uint8Array;
}

const POLICY_VARIABLES = Object.freeze({
  deployment: Object.freeze({
    capacity: 'IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY',
    refillInterval: 'IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US',
  }),
  network: Object.freeze({
    capacity: 'IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY',
    refillInterval: 'IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US',
  }),
  presentedCredential: Object.freeze({
    capacity: 'IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY',
    refillInterval: 'IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US',
  }),
} as const);

function withDefaults(
  environment: ConfigurationInput,
  deploymentEnvironment: DeploymentEnvironment,
): ConfigurationInput {
  const useLocalDefaults = deploymentEnvironment === 'local' || deploymentEnvironment === 'test';

  return {
    IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: environment['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET'],
    IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE:
      environment['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE'],
    IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE:
      environment['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE'] ??
      (useLocalDefaults ? deploymentEnvironment : undefined),
    IDENTITY_CREDENTIAL_ABUSE_EPOCH:
      environment['IDENTITY_CREDENTIAL_ABUSE_EPOCH'] ??
      (useLocalDefaults ? DEFAULT_IDENTITY_CREDENTIAL_ABUSE_EPOCH : undefined),
    IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY:
      environment['IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY'] ??
      String(DEFAULT_REFRESH_DEPLOYMENT_CAPACITY),
    IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US:
      environment['IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US'] ??
      String(DEFAULT_REFRESH_DEPLOYMENT_REFILL_INTERVAL_MICROSECONDS),
    IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY:
      environment['IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY'] ??
      String(DEFAULT_REFRESH_NETWORK_CAPACITY),
    IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US:
      environment['IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US'] ??
      String(DEFAULT_REFRESH_NETWORK_REFILL_INTERVAL_MICROSECONDS),
    IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY:
      environment['IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY'] ??
      String(DEFAULT_REFRESH_PRESENTED_CREDENTIAL_CAPACITY),
    IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US:
      environment['IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US'] ??
      String(DEFAULT_REFRESH_PRESENTED_CREDENTIAL_REFILL_INTERVAL_MICROSECONDS),
  };
}

function addSecretSourceErrors(
  environment: ConfigurationInput,
  invalidVariables: Set<string>,
): void {
  const hasValue = environment['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET'] !== undefined;
  const hasFile = environment['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE'] !== undefined;

  if (hasValue === hasFile) {
    invalidVariables.add('IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET');
    invalidVariables.add('IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE');
  }
}

function addBucketHorizonErrors(
  environment: ConfigurationInput,
  invalidVariables: Set<string>,
): void {
  const policies = [
    {
      variables: POLICY_VARIABLES.deployment,
    },
    {
      variables: POLICY_VARIABLES.network,
    },
    {
      variables: POLICY_VARIABLES.presentedCredential,
    },
  ] as const;

  for (const policy of policies) {
    const capacity = capacitySchema.safeParse(environment[policy.variables.capacity]);
    const interval = refillIntervalSchema.safeParse(environment[policy.variables.refillInterval]);

    if (
      capacity.success &&
      interval.success &&
      capacity.data * interval.data > MAXIMUM_BUCKET_REFILL_HORIZON_MICROSECONDS
    ) {
      invalidVariables.add(policy.variables.capacity);
      invalidVariables.add(policy.variables.refillInterval);
    }
  }
}

function hmacSecretSource(
  environment: IdentityCredentialAbuseEnvironment,
): IdentityCredentialAbuseHmacSecretSource {
  if (environment.IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET !== undefined) {
    return Object.freeze({
      kind: 'value',
      value: environment.IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET,
      variableName: 'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET',
    });
  }

  const path = environment.IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE;

  if (path === undefined) {
    throw new InvalidConfigurationError([
      'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET',
      'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE',
    ]);
  }

  return Object.freeze({
    kind: 'file',
    path,
    variableName: 'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE',
  });
}

function bucketPolicy(
  capacity: number,
  refillIntervalMicroseconds: number,
): IdentityCredentialAbuseBucketPolicy {
  return Object.freeze({ capacity, refillIntervalMicroseconds });
}

function refreshPolicy(
  environment: IdentityCredentialAbuseEnvironment,
): IdentityCredentialAbuseRefreshPolicy {
  return Object.freeze({
    deployment: bucketPolicy(
      environment.IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY,
      environment.IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US,
    ),
    network: bucketPolicy(
      environment.IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY,
      environment.IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US,
    ),
    presentedCredential: bucketPolicy(
      environment.IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY,
      environment.IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US,
    ),
  });
}

export function parseIdentityCredentialAbuseConfiguration(
  environment: ConfigurationInput,
  deploymentEnvironment: DeploymentEnvironment,
): IdentityCredentialAbuseConfiguration {
  const environmentWithDefaults = withDefaults(environment, deploymentEnvironment);
  const result = identityCredentialAbuseEnvironmentSchema.safeParse(environmentWithDefaults);
  const invalidVariables = new Set<string>();

  if (!result.success) {
    for (const issue of result.error.issues) {
      invalidVariables.add(String(issue.path[0]));
    }
  }

  addSecretSourceErrors(environmentWithDefaults, invalidVariables);

  addBucketHorizonErrors(environmentWithDefaults, invalidVariables);

  if (!result.success || invalidVariables.size > 0) {
    throw new InvalidConfigurationError([...invalidVariables]);
  }

  return Object.freeze({
    deploymentScope: result.data.IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE,
    epoch: result.data.IDENTITY_CREDENTIAL_ABUSE_EPOCH,
    hmacSecret: hmacSecretSource(result.data),
    refresh: refreshPolicy(result.data),
  });
}

function removeOneTerminalLineEnding(value: Uint8Array): Uint8Array {
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

function resolveHmacSecret(
  source: IdentityCredentialAbuseHmacSecretSource,
  options: IdentityCredentialAbuseSecretResolutionOptions,
): string | undefined {
  if (source.kind === 'value') {
    return HMAC_SECRET_PATTERN.test(source.value) ? source.value : undefined;
  }

  try {
    const maximumFileBytes =
      IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_HEX_LENGTH +
      MAXIMUM_TERMINAL_LINE_ENDING_BYTES +
      OVERSIZE_SENTINEL_BYTES;
    const fileBytes = options.readFile(
      resolve(options.baseDirectory, source.path),
      maximumFileBytes,
    );
    const maximumValidFileBytes =
      IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_HEX_LENGTH + MAXIMUM_TERMINAL_LINE_ENDING_BYTES;

    if (!(fileBytes instanceof Uint8Array) || fileBytes.byteLength > maximumValidFileBytes) {
      return undefined;
    }

    const secretBytes = removeOneTerminalLineEnding(Buffer.from(fileBytes));

    if (secretBytes.byteLength !== IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_HEX_LENGTH) {
      return undefined;
    }

    const secret = decodeCanonicalUtf8(secretBytes);

    return secret !== undefined && HMAC_SECRET_PATTERN.test(secret) ? secret : undefined;
  } catch {
    return undefined;
  }
}

function copyRefreshPolicy(
  policy: IdentityCredentialAbuseRefreshPolicy,
): IdentityCredentialAbuseRefreshPolicy {
  return Object.freeze({
    deployment: bucketPolicy(
      policy.deployment.capacity,
      policy.deployment.refillIntervalMicroseconds,
    ),
    network: bucketPolicy(policy.network.capacity, policy.network.refillIntervalMicroseconds),
    presentedCredential: bucketPolicy(
      policy.presentedCredential.capacity,
      policy.presentedCredential.refillIntervalMicroseconds,
    ),
  });
}

export function resolveIdentityCredentialAbuseConfiguration(
  configuration: IdentityCredentialAbuseConfiguration,
  options: IdentityCredentialAbuseSecretResolutionOptions,
): ResolvedIdentityCredentialAbuseConfiguration {
  if (!isAbsolute(options.baseDirectory)) {
    throw new TypeError('Identity credential abuse secret base directory must be absolute');
  }

  const hmacSecret = resolveHmacSecret(configuration.hmacSecret, options);

  if (hmacSecret === undefined) {
    throw new InvalidConfigurationError([configuration.hmacSecret.variableName]);
  }

  return Object.freeze({
    deploymentScope: configuration.deploymentScope,
    epoch: configuration.epoch,
    hmacSecret,
    refresh: copyRefreshPolicy(configuration.refresh),
  });
}
