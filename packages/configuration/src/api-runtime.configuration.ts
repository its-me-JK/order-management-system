import { z } from 'zod';

const DEFAULT_HTTP_PORT = 3000;

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const deploymentEnvironmentSchema = z.enum(['local', 'test', 'showcase', 'staging', 'production']);

const apiRuntimeEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .optional()
    .transform((value) => value ?? 'development'),
  PORT: z
    .string()
    .regex(/^[1-9]\d{0,4}$/)
    .transform(Number)
    .pipe(z.number().int().max(65_535))
    .optional()
    .transform((value) => value ?? DEFAULT_HTTP_PORT),
  DEPLOYMENT_ENVIRONMENT: deploymentEnvironmentSchema.optional(),
  LOG_LEVEL: logLevelSchema.optional(),
  WEB_ORIGIN: z.string().optional(),
});

export type RuntimeEnvironment = 'development' | 'test' | 'production';
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

export interface ApiRuntimeConfiguration {
  readonly corsOrigin: string | null;
  readonly environment: RuntimeEnvironment;
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly http: Readonly<{
    port: number;
  }>;
  readonly logging: Readonly<{
    level: LogLevel;
  }>;
}

function parseWebOrigin(
  value: string | undefined,
  deploymentEnvironment: DeploymentEnvironment,
): string | null {
  if (value === undefined || value === 'same-origin') {
    return deploymentEnvironment === 'local' ? 'http://localhost:3001' : null;
  }

  try {
    const url = new URL(value);
    const isLocalHttp =
      deploymentEnvironment === 'local' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname);
    const isDeployedHttps = deploymentEnvironment !== 'local' && url.protocol === 'https:';

    if (
      value !== url.origin ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      (!isLocalHttp && !isDeployedHttps)
    ) {
      throw new Error('invalid origin');
    }

    return url.origin;
  } catch {
    throw new InvalidConfigurationError(['WEB_ORIGIN']);
  }
}

export class InvalidConfigurationError extends Error {
  public constructor(variableNames: readonly string[]) {
    const invalidVariables = [...new Set(variableNames)].sort().join(', ');

    super(`Invalid runtime configuration: ${invalidVariables}`);
    this.name = 'InvalidConfigurationError';
  }
}

export function parseApiRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): ApiRuntimeConfiguration {
  const result = apiRuntimeEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const variableNames = result.error.issues.map((issue) => String(issue.path[0]));

    throw new InvalidConfigurationError(variableNames);
  }

  if (result.data.NODE_ENV === 'production' && result.data.DEPLOYMENT_ENVIRONMENT === undefined) {
    throw new InvalidConfigurationError(['DEPLOYMENT_ENVIRONMENT']);
  }

  const deploymentEnvironment =
    result.data.DEPLOYMENT_ENVIRONMENT ?? (result.data.NODE_ENV === 'test' ? 'test' : 'local');

  const deploymentMatchesRuntime =
    (result.data.NODE_ENV === 'development' && deploymentEnvironment === 'local') ||
    (result.data.NODE_ENV === 'test' && deploymentEnvironment === 'test') ||
    (result.data.NODE_ENV === 'production' &&
      ['showcase', 'staging', 'production'].includes(deploymentEnvironment));

  if (!deploymentMatchesRuntime) {
    throw new InvalidConfigurationError(['DEPLOYMENT_ENVIRONMENT']);
  }

  const logLevel =
    result.data.LOG_LEVEL ??
    (result.data.NODE_ENV === 'production'
      ? 'info'
      : result.data.NODE_ENV === 'test'
        ? 'silent'
        : 'debug');

  return Object.freeze({
    corsOrigin: parseWebOrigin(result.data.WEB_ORIGIN, deploymentEnvironment),
    environment: result.data.NODE_ENV,
    deploymentEnvironment,
    http: Object.freeze({
      port: result.data.PORT,
    }),
    logging: Object.freeze({
      level: logLevel,
    }),
  });
}
