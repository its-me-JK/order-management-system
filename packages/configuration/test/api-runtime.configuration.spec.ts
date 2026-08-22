import { InvalidConfigurationError, parseApiRuntimeConfiguration } from '../src';

describe('parseApiRuntimeConfiguration', (): void => {
  it('applies safe local defaults when optional values are absent', (): void => {
    expect(parseApiRuntimeConfiguration({})).toEqual({
      deploymentEnvironment: 'local',
      environment: 'development',
      http: {
        port: 3000,
      },
      logging: {
        level: 'debug',
      },
    });
  });

  it('parses an explicitly configured production runtime', (): void => {
    expect(
      parseApiRuntimeConfiguration({
        DEPLOYMENT_ENVIRONMENT: 'showcase',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'production',
        PORT: '8080',
      }),
    ).toEqual({
      deploymentEnvironment: 'showcase',
      environment: 'production',
      http: {
        port: 8080,
      },
      logging: {
        level: 'warn',
      },
    });
  });

  it('uses quiet test logging without mislabelling the deployment', (): void => {
    expect(parseApiRuntimeConfiguration({ NODE_ENV: 'test' })).toEqual({
      deploymentEnvironment: 'test',
      environment: 'test',
      http: {
        port: 3000,
      },
      logging: {
        level: 'silent',
      },
    });
  });

  it('defaults production logging to info after deployment is labelled', (): void => {
    expect(
      parseApiRuntimeConfiguration({
        DEPLOYMENT_ENVIRONMENT: 'production',
        NODE_ENV: 'production',
      }).logging.level,
    ).toBe('info');
  });

  it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const)(
    'accepts the %s log level',
    (level): void => {
      expect(parseApiRuntimeConfiguration({ LOG_LEVEL: level }).logging.level).toBe(level);
    },
  );

  it.each([
    ['lowest', '1', 1],
    ['highest', '65535', 65_535],
  ])('accepts the %s TCP port boundary', (_description, port, expectedPort): void => {
    expect(parseApiRuntimeConfiguration({ PORT: port }).http.port).toBe(expectedPort);
  });

  it('returns an immutable configuration object', (): void => {
    const configuration = parseApiRuntimeConfiguration({});

    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.http)).toBe(true);
    expect(Object.isFrozen(configuration.logging)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['zero', '0'],
    ['negative', '-1'],
    ['above the TCP range', '65536'],
    ['fractional', '3000.5'],
    ['surrounded by whitespace', ' 3000 '],
    ['non-numeric', 'three-thousand'],
    ['scientific notation', '3e3'],
    ['hexadecimal notation', '0x0bb8'],
  ])('rejects a %s port', (_description, port): void => {
    expect(() => parseApiRuntimeConfiguration({ PORT: port })).toThrow(
      new InvalidConfigurationError(['PORT']),
    );
  });

  it('rejects unsupported Node.js runtime modes', (): void => {
    expect(() => parseApiRuntimeConfiguration({ NODE_ENV: 'showcase' })).toThrow(
      new InvalidConfigurationError(['NODE_ENV']),
    );
  });

  it('requires an explicit deployment label when Node runs in production mode', (): void => {
    expect(() => parseApiRuntimeConfiguration({ NODE_ENV: 'production' })).toThrow(
      new InvalidConfigurationError(['DEPLOYMENT_ENVIRONMENT']),
    );
  });

  it.each(['verbose', 'INFO', ''])('rejects an unsupported log level: %s', (level): void => {
    expect(() => parseApiRuntimeConfiguration({ LOG_LEVEL: level })).toThrow(
      new InvalidConfigurationError(['LOG_LEVEL']),
    );
  });

  it.each(['preview', 'demo', ''])(
    'rejects an unsupported deployment environment: %s',
    (deploymentEnvironment): void => {
      expect(() =>
        parseApiRuntimeConfiguration({ DEPLOYMENT_ENVIRONMENT: deploymentEnvironment }),
      ).toThrow(new InvalidConfigurationError(['DEPLOYMENT_ENVIRONMENT']));
    },
  );

  it('ignores unrelated environment variables without mutating the source', (): void => {
    const environment = {
      NODE_ENV: 'test',
      PORT: '4000',
      UNRELATED_VARIABLE: 'unchanged',
    } as const;

    const snapshot = { ...environment };

    expect(parseApiRuntimeConfiguration(environment)).toEqual({
      deploymentEnvironment: 'test',
      environment: 'test',
      http: {
        port: 4000,
      },
      logging: {
        level: 'silent',
      },
    });
    expect(environment).toEqual(snapshot);
  });

  it('reports only invalid variable names and never their values', (): void => {
    const invalidDeploymentEnvironment = 'sensitive-preview';
    const invalidLogLevel = 'secret-level';
    const invalidEnvironment = 'preview-with-sensitive-context';
    const invalidPort = 'secret-looking-port';

    expect.assertions(6);

    try {
      parseApiRuntimeConfiguration({
        DEPLOYMENT_ENVIRONMENT: invalidDeploymentEnvironment,
        LOG_LEVEL: invalidLogLevel,
        NODE_ENV: invalidEnvironment,
        PORT: invalidPort,
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error).toHaveProperty(
        'message',
        'Invalid runtime configuration: DEPLOYMENT_ENVIRONMENT, LOG_LEVEL, NODE_ENV, PORT',
      );
      expect(String(error)).not.toContain(invalidDeploymentEnvironment);
      expect(String(error)).not.toContain(invalidLogLevel);
      expect(String(error)).not.toContain(invalidEnvironment);
      expect(String(error)).not.toContain(invalidPort);
    }
  });
});
