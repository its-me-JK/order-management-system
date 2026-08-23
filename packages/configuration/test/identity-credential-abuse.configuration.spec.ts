import {
  InvalidConfigurationError,
  parseIdentityCredentialAbuseConfiguration,
  resolveIdentityCredentialAbuseConfiguration,
  type DeploymentEnvironment,
  type IdentityCredentialAbuseConfiguration,
} from '../src';

const HMAC_SECRET = 'ab'.repeat(32);
const ALTERNATE_HMAC_SECRET = '01'.repeat(32);

function parseLocal(
  overrides: Readonly<Record<string, string | undefined>> = {},
  deploymentEnvironment: DeploymentEnvironment = 'local',
): IdentityCredentialAbuseConfiguration {
  return parseIdentityCredentialAbuseConfiguration(
    {
      IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: HMAC_SECRET,
      ...overrides,
    },
    deploymentEnvironment,
  );
}

describe('parseIdentityCredentialAbuseConfiguration', (): void => {
  it('applies the reviewed local refresh policy without resolving a file secret', (): void => {
    expect(
      parseIdentityCredentialAbuseConfiguration(
        {
          IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: '.local/secrets/identity-abuse-hmac-secret',
        },
        'local',
      ),
    ).toEqual({
      deploymentScope: 'local',
      epoch: 'v1',
      hmacSecret: {
        kind: 'file',
        path: '.local/secrets/identity-abuse-hmac-secret',
        variableName: 'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE',
      },
      refresh: {
        deployment: {
          capacity: 300,
          refillIntervalMicroseconds: 200_000,
        },
        network: {
          capacity: 120,
          refillIntervalMicroseconds: 2_500_000,
        },
        presentedCredential: {
          capacity: 3,
          refillIntervalMicroseconds: 100_000_000,
        },
      },
    });
  });

  it('uses the isolated test deployment as the test default scope', (): void => {
    expect(parseLocal({}, 'test')).toEqual(
      expect.objectContaining({ deploymentScope: 'test', epoch: 'v1' }),
    );
  });

  it.each(['showcase', 'staging', 'production'] as const)(
    'requires explicit scope and epoch for %s replicas',
    (deploymentEnvironment): void => {
      expect(() =>
        parseIdentityCredentialAbuseConfiguration(
          { IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: HMAC_SECRET },
          deploymentEnvironment,
        ),
      ).toThrow(
        new InvalidConfigurationError([
          'IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE',
          'IDENTITY_CREDENTIAL_ABUSE_EPOCH',
        ]),
      );
    },
  );

  it('parses an explicit deployed namespace and policy epoch', (): void => {
    expect(
      parseIdentityCredentialAbuseConfiguration(
        {
          IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: HMAC_SECRET,
          IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE: 'orders-showcase.ap-south-1',
          IDENTITY_CREDENTIAL_ABUSE_EPOCH: 'v2026-08',
        },
        'showcase',
      ),
    ).toEqual(
      expect.objectContaining({
        deploymentScope: 'orders-showcase.ap-south-1',
        epoch: 'v2026-08',
      }),
    );
  });

  it('maps every explicit refresh dimension without crossing policy fields', (): void => {
    expect(
      parseLocal({
        IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY: '41',
        IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US: '41000',
        IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY: '42',
        IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US: '42000',
        IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY: '43',
        IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US: '43000',
      }).refresh,
    ).toEqual({
      deployment: { capacity: 41, refillIntervalMicroseconds: 41_000 },
      network: { capacity: 42, refillIntervalMicroseconds: 42_000 },
      presentedCredential: { capacity: 43, refillIntervalMicroseconds: 43_000 },
    });
  });

  it.each([
    ['neither source exists', {}],
    [
      'both sources exist',
      {
        IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: HMAC_SECRET,
        IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: '/run/secrets/identity-abuse-hmac',
      },
    ],
  ])('requires exactly one HMAC secret source when %s', (_scenario, environment): void => {
    expect(() => parseIdentityCredentialAbuseConfiguration(environment, 'local')).toThrow(
      new InvalidConfigurationError([
        'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET',
        'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE',
      ]),
    );
  });

  it('accepts only canonical lowercase hex for the inline encoded secret', (): void => {
    expect(parseLocal().hmacSecret).toEqual({
      kind: 'value',
      value: HMAC_SECRET,
      variableName: 'IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET',
    });

    for (const value of [
      '',
      'a'.repeat(63),
      'a'.repeat(65),
      'A'.repeat(64),
      `${'a'.repeat(63)}g`,
      `${'a'.repeat(63)} `,
      `${'a'.repeat(63)}\n`,
      'é'.repeat(32),
      `${'a'.repeat(63)}\ud800`,
    ]) {
      expect(() => parseLocal({ IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: value })).toThrow(
        new InvalidConfigurationError(['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET']),
      );
    }
  });

  it('accepts exact deployment-scope and epoch boundaries', (): void => {
    const singleCharacter = parseLocal({
      IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE: 'a',
      IDENTITY_CREDENTIAL_ABUSE_EPOCH: '1',
    });
    const maximumLength = parseLocal({
      IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE: `a${'b'.repeat(62)}z`,
      IDENTITY_CREDENTIAL_ABUSE_EPOCH: `v${'1'.repeat(30)}z`,
    });

    expect(singleCharacter.deploymentScope).toBe('a');
    expect(singleCharacter.epoch).toBe('1');
    expect(maximumLength.deploymentScope).toHaveLength(64);
    expect(maximumLength.epoch).toHaveLength(32);
  });

  it.each([
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', ''],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', `a${'b'.repeat(64)}`],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', '-orders'],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', 'orders-'],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', 'Orders'],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', 'orders scope'],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', 'orders/prod'],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', 'ordérs'],
    ['IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE', 'orders\u0000'],
    ['IDENTITY_CREDENTIAL_ABUSE_EPOCH', ''],
    ['IDENTITY_CREDENTIAL_ABUSE_EPOCH', `v${'1'.repeat(32)}`],
    ['IDENTITY_CREDENTIAL_ABUSE_EPOCH', '-v1'],
    ['IDENTITY_CREDENTIAL_ABUSE_EPOCH', 'v1-'],
    ['IDENTITY_CREDENTIAL_ABUSE_EPOCH', 'V1'],
    ['IDENTITY_CREDENTIAL_ABUSE_EPOCH', 'v1/next'],
    ['IDENTITY_CREDENTIAL_ABUSE_EPOCH', 'vé'],
  ])('rejects an invalid %s token', (variableName, value): void => {
    expect(() => parseLocal({ [variableName]: value })).toThrow(
      new InvalidConfigurationError([variableName]),
    );
  });

  it.each([
    'IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY',
    'IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY',
    'IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY',
  ] as const)('accepts both capacity boundaries for %s', (variableName): void => {
    expect(parseLocal({ [variableName]: '1' }).refresh).toBeDefined();
    expect(
      parseLocal({
        [variableName]: '10000',
        [variableName.replace('_CAPACITY', '_REFILL_INTERVAL_US')]: '360000',
      }).refresh,
    ).toBeDefined();
  });

  it.each([
    'IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US',
    'IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US',
    'IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US',
  ] as const)('accepts both refill-interval boundaries for %s', (variableName): void => {
    const capacityVariableName = variableName.replace('_REFILL_INTERVAL_US', '_CAPACITY');

    expect(parseLocal({ [variableName]: '1000' }).refresh).toBeDefined();
    expect(
      parseLocal({
        [capacityVariableName]: '20',
        [variableName]: '180000000',
      }).refresh,
    ).toBeDefined();
  });

  it.each([
    ['IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY', '0'],
    ['IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY', '10001'],
    ['IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY', '-1'],
    ['IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY', '1.5'],
    ['IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY', '01'],
    ['IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY', '1e2'],
    ['IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US', '999'],
    ['IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US', '180000001'],
    ['IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US', '2500000.0'],
    ['IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US', ' 2500000 '],
    ['IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US', '0x5f5e100'],
    ['IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US', '01000'],
  ])('rejects an invalid bounded decimal for %s', (variableName, value): void => {
    expect(() => parseLocal({ [variableName]: value })).toThrow(
      new InvalidConfigurationError([variableName]),
    );
  });

  it.each([
    [
      'IDENTITY_REFRESH_ABUSE_DEPLOYMENT_CAPACITY',
      'IDENTITY_REFRESH_ABUSE_DEPLOYMENT_REFILL_INTERVAL_US',
    ],
    [
      'IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY',
      'IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US',
    ],
    [
      'IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_CAPACITY',
      'IDENTITY_REFRESH_ABUSE_PRESENTED_CREDENTIAL_REFILL_INTERVAL_US',
    ],
  ] as const)(
    'accepts the exact refill horizon and rejects one capacity step over for %s',
    (capacityVariable, intervalVariable): void => {
      expect(
        parseLocal({
          [capacityVariable]: '20',
          [intervalVariable]: '180000000',
        }).refresh,
      ).toBeDefined();

      expect(() =>
        parseLocal({
          [capacityVariable]: '21',
          [intervalVariable]: '180000000',
        }),
      ).toThrow(new InvalidConfigurationError([capacityVariable, intervalVariable]));
    },
  );

  it('returns a deeply immutable policy and secret-source graph', (): void => {
    const configuration = parseLocal();

    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.hmacSecret)).toBe(true);
    expect(Object.isFrozen(configuration.refresh)).toBe(true);
    expect(Object.isFrozen(configuration.refresh.deployment)).toBe(true);
    expect(Object.isFrozen(configuration.refresh.network)).toBe(true);
    expect(Object.isFrozen(configuration.refresh.presentedCredential)).toBe(true);
  });

  it('ignores unrelated variables without mutating the input', (): void => {
    const environment = {
      IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: HMAC_SECRET,
      IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY: '99',
      UNRELATED_SECRET_LOOKING_VALUE: 'unchanged',
    } as const;
    const snapshot = { ...environment };

    expect(parseIdentityCredentialAbuseConfiguration(environment, 'test').refresh.network).toEqual({
      capacity: 99,
      refillIntervalMicroseconds: 2_500_000,
    });
    expect(environment).toEqual(snapshot);
  });

  it('aggregates variable names without exposing namespace, epoch, or secret values', (): void => {
    const secret = `A${'b'.repeat(63)}`;
    const deploymentScope = 'Private Production Scope';
    const epoch = 'Confidential Epoch';

    expect.assertions(7);

    try {
      parseIdentityCredentialAbuseConfiguration(
        {
          IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: secret,
          IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE: deploymentScope,
          IDENTITY_CREDENTIAL_ABUSE_EPOCH: epoch,
          IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY: '21',
          IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US: '180000000',
        },
        'production',
      );
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error).toHaveProperty(
        'message',
        'Invalid runtime configuration: IDENTITY_CREDENTIAL_ABUSE_DEPLOYMENT_SCOPE, IDENTITY_CREDENTIAL_ABUSE_EPOCH, IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET, IDENTITY_REFRESH_ABUSE_NETWORK_CAPACITY, IDENTITY_REFRESH_ABUSE_NETWORK_REFILL_INTERVAL_US',
      );
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(deploymentScope);
      expect(String(error)).not.toContain(epoch);
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});

describe('resolveIdentityCredentialAbuseConfiguration', (): void => {
  it('preserves an inline canonical encoding without reading a file', (): void => {
    const readFile = jest.fn((): Uint8Array => Buffer.from('unused'));
    const resolved = resolveIdentityCredentialAbuseConfiguration(parseLocal(), {
      baseDirectory: '/srv/oms',
      readFile,
    });

    expect(resolved).toEqual({
      deploymentScope: 'local',
      epoch: 'v1',
      hmacSecret: HMAC_SECRET,
      refresh: {
        deployment: { capacity: 300, refillIntervalMicroseconds: 200_000 },
        network: { capacity: 120, refillIntervalMicroseconds: 2_500_000 },
        presentedCredential: { capacity: 3, refillIntervalMicroseconds: 100_000_000 },
      },
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])(
    'resolves a relative file and removes exactly one terminal %s',
    (_lineEnding, suffix): void => {
      const configuration = parseIdentityCredentialAbuseConfiguration(
        {
          IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: 'secrets/identity-abuse-hmac',
        },
        'test',
      );
      const readFile = jest.fn((): Uint8Array => Buffer.from(`${ALTERNATE_HMAC_SECRET}${suffix}`));
      const resolved = resolveIdentityCredentialAbuseConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile,
      });

      expect(resolved.hmacSecret).toBe(ALTERNATE_HMAC_SECRET);
      expect(readFile).toHaveBeenCalledWith('/srv/oms/secrets/identity-abuse-hmac', 67);
    },
  );

  it('accepts the exact file envelope and rejects the oversize sentinel byte', (): void => {
    const configuration = parseIdentityCredentialAbuseConfiguration(
      { IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: 'secret' },
      'local',
    );

    expect(
      resolveIdentityCredentialAbuseConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (_path, maximumBytes): Uint8Array => {
          expect(maximumBytes).toBe(67);
          return Buffer.from(`${HMAC_SECRET}\r\n`);
        },
      }).hmacSecret,
    ).toBe(HMAC_SECRET);

    expect(() =>
      resolveIdentityCredentialAbuseConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Buffer.alloc(67, 0x61),
      }),
    ).toThrow(new InvalidConfigurationError(['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE']));
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['only LF', Buffer.from('\n')],
    ['only CRLF', Buffer.from('\r\n')],
    ['too short', Buffer.from('a'.repeat(63))],
    ['too long without a line ending', Buffer.from('a'.repeat(65))],
    ['uppercase hex', Buffer.from('A'.repeat(64))],
    ['non-hex ASCII', Buffer.from(`${'a'.repeat(63)}g`)],
    ['two terminal line endings', Buffer.from(`${HMAC_SECRET}\n\n`)],
    ['bare terminal carriage return', Buffer.from(`${HMAC_SECRET}\r`)],
    [
      'UTF-8 byte-order mark',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a'.repeat(61))]),
    ],
    ['malformed UTF-8', Uint8Array.from([...Buffer.from('a'.repeat(62)), 0xc0, 0xaf])],
  ])('rejects %s file contents', (_scenario, contents): void => {
    const configuration = parseIdentityCredentialAbuseConfiguration(
      { IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: 'secret' },
      'local',
    );

    expect(() =>
      resolveIdentityCredentialAbuseConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => contents,
      }),
    ).toThrow(new InvalidConfigurationError(['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE']));
  });

  it('rejects a non-byte file-provider result without inspecting it', (): void => {
    const configuration = parseIdentityCredentialAbuseConfiguration(
      { IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: 'secret' },
      'local',
    );

    expect(() =>
      resolveIdentityCredentialAbuseConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => 'not-bytes' as unknown as Uint8Array,
      }),
    ).toThrow(new InvalidConfigurationError(['IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE']));
  });

  it('maps hostile file failures to one cause-free credential-safe error', (): void => {
    const path = 'private/identity-hmac-path-must-not-leak';
    const providerCause = 'provider-cause-must-not-leak';
    const configuration = parseIdentityCredentialAbuseConfiguration(
      { IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: path },
      'local',
    );

    expect.assertions(6);

    try {
      resolveIdentityCredentialAbuseConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): never => {
          throw new Error(providerCause);
        },
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error).toHaveProperty(
        'message',
        'Invalid runtime configuration: IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE',
      );
      expect(String(error)).not.toContain(path);
      expect(String(error)).not.toContain(providerCause);
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain(providerCause);
    }
  });

  it('does not expose malformed file contents through the resolution error', (): void => {
    const malformedSecret = 'private-material-that-must-not-leak'.padEnd(64, 'G');
    const configuration = parseIdentityCredentialAbuseConfiguration(
      { IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE: 'secret' },
      'local',
    );

    expect.assertions(4);

    try {
      resolveIdentityCredentialAbuseConfiguration(configuration, {
        baseDirectory: '/srv/oms',
        readFile: (): Uint8Array => Buffer.from(malformedSecret),
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error).toHaveProperty(
        'message',
        'Invalid runtime configuration: IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET_FILE',
      );
      expect(String(error)).not.toContain(malformedSecret);
      expect(error).not.toHaveProperty('cause');
    }
  });

  it('returns a fresh deeply frozen resolved graph', (): void => {
    const configuration = parseLocal({
      IDENTITY_CREDENTIAL_ABUSE_HMAC_SECRET: ALTERNATE_HMAC_SECRET,
    });
    const resolved = resolveIdentityCredentialAbuseConfiguration(configuration, {
      baseDirectory: '/srv/oms',
      readFile: (): Uint8Array => Buffer.alloc(0),
    });

    expect(resolved.refresh).not.toBe(configuration.refresh);
    expect(resolved.refresh.deployment).not.toBe(configuration.refresh.deployment);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.refresh)).toBe(true);
    expect(Object.isFrozen(resolved.refresh.deployment)).toBe(true);
    expect(Object.isFrozen(resolved.refresh.network)).toBe(true);
    expect(Object.isFrozen(resolved.refresh.presentedCredential)).toBe(true);
  });

  it('requires an absolute secret base directory even for an inline value', (): void => {
    expect(() =>
      resolveIdentityCredentialAbuseConfiguration(parseLocal(), {
        baseDirectory: 'relative/path',
        readFile: (): Uint8Array => Buffer.alloc(0),
      }),
    ).toThrow(new TypeError('Identity credential abuse secret base directory must be absolute'));
  });
});
