import { z } from 'zod';

const DEFAULT_HTTP_PORT = 3000;

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
});

export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface ApiRuntimeConfiguration {
  readonly environment: RuntimeEnvironment;
  readonly http: Readonly<{
    port: number;
  }>;
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

  return Object.freeze({
    environment: result.data.NODE_ENV,
    http: Object.freeze({
      port: result.data.PORT,
    }),
  });
}
