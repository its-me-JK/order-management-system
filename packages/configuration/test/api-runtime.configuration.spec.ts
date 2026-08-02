import { InvalidConfigurationError, parseApiRuntimeConfiguration } from '../src';

describe('parseApiRuntimeConfiguration', (): void => {
  it('applies safe local defaults when optional values are absent', (): void => {
    expect(parseApiRuntimeConfiguration({})).toEqual({
      environment: 'development',
      http: {
        port: 3000,
      },
    });
  });

  it('parses an explicitly configured production runtime', (): void => {
    expect(
      parseApiRuntimeConfiguration({
        NODE_ENV: 'production',
        PORT: '8080',
      }),
    ).toEqual({
      environment: 'production',
      http: {
        port: 8080,
      },
    });
  });

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

  it('ignores unrelated environment variables without mutating the source', (): void => {
    const environment = {
      NODE_ENV: 'test',
      PORT: '4000',
      UNRELATED_VARIABLE: 'unchanged',
    } as const;

    const snapshot = { ...environment };

    expect(parseApiRuntimeConfiguration(environment)).toEqual({
      environment: 'test',
      http: {
        port: 4000,
      },
    });
    expect(environment).toEqual(snapshot);
  });

  it('reports only invalid variable names and never their values', (): void => {
    const invalidEnvironment = 'preview-with-sensitive-context';
    const invalidPort = 'secret-looking-port';

    expect.assertions(4);

    try {
      parseApiRuntimeConfiguration({
        NODE_ENV: invalidEnvironment,
        PORT: invalidPort,
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error).toHaveProperty('message', 'Invalid runtime configuration: NODE_ENV, PORT');
      expect(String(error)).not.toContain(invalidEnvironment);
      expect(String(error)).not.toContain(invalidPort);
    }
  });
});
