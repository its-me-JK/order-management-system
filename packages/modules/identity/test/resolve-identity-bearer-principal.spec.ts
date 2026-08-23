import {
  IdentityBearerResolutionUnavailableError,
  ResolveIdentityBearerPrincipal,
  type IdentityBearerPrincipalResolution,
} from '../src';
import {
  IdentityAccessAuthorityPersistenceError,
  IdentityAccessAuthorityUnavailableError,
} from '../src/application/identity-access-authority.errors';
import {
  IDENTITY_ACCESS_AUTHORITY_REJECTED,
  type IdentityAccessAuthorityReader,
  type IdentityAccessAuthorityResult,
} from '../src/application/identity-access-authority.reader';
import { createIdentityAuthenticatedPrincipalFromAuthority } from '../src/application/identity-authenticated-principal';
import { InvalidIdentityAuthenticatedPrincipalError } from '../src/application/identity-authenticated-principal.errors';
import { IdentityBearerResolutionError } from '../src/application/identity-bearer-resolution.errors';
import type { IdentitySessionCredentialCrypto } from '../src/application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
} from '../src/application/identity-session-credential-digest.values';
import {
  IdentitySessionCredentialCryptoUnavailableError,
  InvalidIdentityAccessCredentialDigestError,
} from '../src/application/identity-session-credential.errors';
import { serializeIdentityAccessCredentialWireValue } from '../src/application/identity-session-credential-wire.values';

const ACCESS_WIRE_VALUE = 'oms_at_v1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const INTERNAL_FAILURE_MESSAGE = 'Identity Bearer resolution failed';
const UNAVAILABLE_MESSAGE = 'Identity Bearer resolution is temporarily unavailable';

type CredentialDigester = Pick<IdentitySessionCredentialCrypto, 'digestAccessCredential'>;
type DigestAccessCredential = CredentialDigester['digestAccessCredential'];
type ResolveByAccessCredentialDigest =
  IdentityAccessAuthorityReader['resolveByAccessCredentialDigest'];
type ErrorClass = abstract new (...arguments_: never[]) => Error;

type ResolverFixture = Readonly<{
  accessCredentialDigest: IdentityAccessCredentialDigest;
  authorityReader: IdentityAccessAuthorityReader;
  credentialDigester: CredentialDigester;
  digestAccessCredential: jest.MockedFunction<DigestAccessCredential>;
  resolveByAccessCredentialDigest: jest.MockedFunction<ResolveByAccessCredentialDigest>;
  resolver: ResolveIdentityBearerPrincipal;
}>;

function accessCredentialDigest(seed = 17): IdentityAccessCredentialDigest {
  return createIdentityAccessCredentialDigestFromBytes(
    Uint8Array.from({ length: 32 }, (_value, index): number => (seed + index * 13) % 256),
  );
}

function authenticatedPrincipal(permissions: readonly string[] = ['catalog.products.read']) {
  return createIdentityAuthenticatedPrincipalFromAuthority({
    actorId: ACTOR_ID,
    sessionId: SESSION_ID,
    activeRoleCount: permissions.length === 0 ? 0 : 1,
    permissions,
  });
}

function resolvedAuthority(
  permissions: readonly string[] = ['catalog.products.read'],
): IdentityAccessAuthorityResult {
  return Object.freeze({
    kind: 'resolved' as const,
    principal: authenticatedPrincipal(permissions),
  });
}

function resolverFixture(
  authorityResult: IdentityAccessAuthorityResult = IDENTITY_ACCESS_AUTHORITY_REJECTED,
): ResolverFixture {
  const digestAccessCredential = jest.fn<
    ReturnType<DigestAccessCredential>,
    Parameters<DigestAccessCredential>
  >();
  const resolveByAccessCredentialDigest = jest.fn<
    ReturnType<ResolveByAccessCredentialDigest>,
    Parameters<ResolveByAccessCredentialDigest>
  >();
  const accessDigest = accessCredentialDigest();
  const credentialDigester: CredentialDigester = { digestAccessCredential };
  const authorityReader: IdentityAccessAuthorityReader = { resolveByAccessCredentialDigest };

  digestAccessCredential.mockResolvedValue(accessDigest);
  resolveByAccessCredentialDigest.mockResolvedValue(authorityResult);

  return {
    accessCredentialDigest: accessDigest,
    authorityReader,
    credentialDigester,
    digestAccessCredential,
    resolveByAccessCredentialDigest,
    resolver: new ResolveIdentityBearerPrincipal(credentialDigester, authorityReader),
  };
}

async function captureAsyncError(operation: () => Promise<unknown>): Promise<Error> {
  const pending = operation();
  expect(pending).toBeInstanceOf(Promise);

  try {
    await pending;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the resolver operation to reject');
}

function captureSynchronousError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the resolver operation to throw');
}

function expectFixedError(
  error: Error,
  ExpectedError: ErrorClass,
  expectedName: string,
  expectedMessage: string,
  rejectedValues: readonly string[] = [],
): void {
  expect(error).toBeInstanceOf(ExpectedError);
  expect(error).toMatchObject({ name: expectedName, message: expectedMessage });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
    expect(error.stack ?? '').not.toContain(rejectedValue);
  }
}

async function expectInternalFailure(
  operation: () => Promise<unknown>,
  rejectedValues: readonly string[] = [],
): Promise<Error> {
  const error = await captureAsyncError(operation);
  expectFixedError(
    error,
    IdentityBearerResolutionError,
    'IdentityBearerResolutionError',
    INTERNAL_FAILURE_MESSAGE,
    rejectedValues,
  );
  return error;
}

async function expectUnavailable(
  operation: () => Promise<unknown>,
  rejectedValues: readonly string[] = [],
): Promise<Error> {
  const error = await captureAsyncError(operation);
  expectFixedError(
    error,
    IdentityBearerResolutionUnavailableError,
    'IdentityBearerResolutionUnavailableError',
    UNAVAILABLE_MESSAGE,
    rejectedValues,
  );
  return error;
}

describe('ResolveIdentityBearerPrincipal successful resolution', (): void => {
  it.each([
    ['current permissions', ['catalog.products.read', 'catalog.skus.write']],
    ['an authenticated principal with no roles or permissions', []],
  ] as const)(
    'resolves %s through one wire-to-digest-to-authority call',
    async (_label, permissions) => {
      const authorityResult = resolvedAuthority(permissions);
      const fixture = resolverFixture(authorityResult);

      const result: IdentityBearerPrincipalResolution =
        await fixture.resolver.execute(ACCESS_WIRE_VALUE);

      expect(fixture.digestAccessCredential).toHaveBeenCalledTimes(1);
      expect(fixture.resolveByAccessCredentialDigest).toHaveBeenCalledTimes(1);
      expect(fixture.digestAccessCredential.mock.contexts[0]).toBe(fixture.credentialDigester);
      expect(fixture.resolveByAccessCredentialDigest.mock.contexts[0]).toBe(
        fixture.authorityReader,
      );

      const wireValue = fixture.digestAccessCredential.mock.calls[0]?.[0];
      const digest = fixture.resolveByAccessCredentialDigest.mock.calls[0]?.[0];

      if (wireValue === undefined) {
        throw new Error('Expected one canonical access wire value');
      }

      expect(serializeIdentityAccessCredentialWireValue(wireValue)).toBe(ACCESS_WIRE_VALUE);
      expect(digest).toBe(fixture.accessCredentialDigest);
      expect(result).toEqual({
        kind: 'resolved',
        principal: {
          actorId: ACTOR_ID,
          sessionId: SESSION_ID,
          permissions,
        },
      });
      expect(result).not.toBe(authorityResult);
      expect(Object.isFrozen(result)).toBe(true);

      if (result.kind !== 'resolved') {
        throw new Error('Expected resolved Identity Bearer authority');
      }

      expect(Object.isFrozen(result.principal)).toBe(true);
      expect(Object.isFrozen(result.principal.permissions)).toBe(true);
      expect(Reflect.ownKeys(result)).toEqual(['kind', 'principal']);
    },
  );

  it('maps all valid authority rejections and malformed wires to one frozen rejection', async (): Promise<void> => {
    const firstFixture = resolverFixture();
    const secondFixture = resolverFixture();
    const malformedFixture = resolverFixture(resolvedAuthority());
    const first = await firstFixture.resolver.execute(ACCESS_WIRE_VALUE);
    const second = await secondFixture.resolver.execute(ACCESS_WIRE_VALUE);
    const malformed = await malformedFixture.resolver.execute('not-an-access-credential');

    expect(first).toEqual({ kind: 'rejected' });
    expect(first).toBe(second);
    expect(first).toBe(malformed);
    expect(first).not.toBe(IDENTITY_ACCESS_AUTHORITY_REJECTED);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.ownKeys(first)).toEqual(['kind']);
    expect(malformedFixture.digestAccessCredential).not.toHaveBeenCalled();
    expect(malformedFixture.resolveByAccessCredentialDigest).not.toHaveBeenCalled();
  });
});

describe('ResolveIdentityBearerPrincipal credential rejection', (): void => {
  it.each([
    ['missing value', undefined],
    ['null value', null],
    ['numeric value', 1],
    ['boxed string', new String(ACCESS_WIRE_VALUE)],
    ['empty value', ''],
    ['complete Authorization field', `Bearer ${ACCESS_WIRE_VALUE}`],
    ['leading whitespace', ` ${ACCESS_WIRE_VALUE}`],
    ['trailing whitespace', `${ACCESS_WIRE_VALUE} `],
    ['wrong scheme prefix', ACCESS_WIRE_VALUE.replace('oms_at_v1_', 'OMS_at_v1_')],
    ['refresh namespace', ACCESS_WIRE_VALUE.replace('oms_at_v1_', 'oms_rt_v1_')],
    ['future version', ACCESS_WIRE_VALUE.replace('oms_at_v1_', 'oms_at_v2_')],
    ['noncanonical final sextet', `${ACCESS_WIRE_VALUE.slice(0, -1)}B`],
  ] as const)('rejects %s before cryptography or persistence', async (_label, value) => {
    const fixture = resolverFixture(resolvedAuthority());

    await expect(fixture.resolver.execute(value)).resolves.toEqual({ kind: 'rejected' });
    expect(fixture.digestAccessCredential).not.toHaveBeenCalled();
    expect(fixture.resolveByAccessCredentialDigest).not.toHaveBeenCalled();
  });
});

describe('ResolveIdentityBearerPrincipal failure taxonomy', (): void => {
  it('normalizes only an exact cryptography-unavailable error to public unavailability', async (): Promise<void> => {
    const fixture = resolverFixture(resolvedAuthority());
    fixture.digestAccessCredential.mockRejectedValue(
      new IdentitySessionCredentialCryptoUnavailableError(),
    );

    await expectUnavailable(() => fixture.resolver.execute(ACCESS_WIRE_VALUE), [ACCESS_WIRE_VALUE]);
    expect(fixture.resolveByAccessCredentialDigest).not.toHaveBeenCalled();
  });

  it('normalizes only an exact authority-unavailable error to public unavailability', async (): Promise<void> => {
    const fixture = resolverFixture(resolvedAuthority());
    fixture.resolveByAccessCredentialDigest.mockRejectedValue(
      new IdentityAccessAuthorityUnavailableError(),
    );

    await expectUnavailable(() => fixture.resolver.execute(ACCESS_WIRE_VALUE), [ACCESS_WIRE_VALUE]);
  });

  it('creates a fresh public unavailable error and never retains a dependency error', async (): Promise<void> => {
    const dependencyError = new IdentitySessionCredentialCryptoUnavailableError();
    const fixture = resolverFixture();
    fixture.digestAccessCredential.mockRejectedValue(dependencyError);

    const first = await expectUnavailable(() => fixture.resolver.execute(ACCESS_WIRE_VALUE));
    first.name = 'MutatedUnavailable';
    first.message = 'mutated-unavailable-message';
    const second = await expectUnavailable(
      () => fixture.resolver.execute(ACCESS_WIRE_VALUE),
      [first.message],
    );

    expect(first).not.toBe(second);
    expect(first).not.toBe(dependencyError);
    expect(second).not.toBe(dependencyError);
  });

  it.each([
    ['cryptography exception', new Error('crypto-provider-secret')],
    [
      'subclassed cryptography-unavailable error',
      new (class extends IdentitySessionCredentialCryptoUnavailableError {})(),
    ],
  ] as const)('treats %s as an internal failure rather than rejection', async (_label, error) => {
    const fixture = resolverFixture();
    fixture.digestAccessCredential.mockRejectedValue(error);

    await expectInternalFailure(
      () => fixture.resolver.execute(ACCESS_WIRE_VALUE),
      [error.message, ACCESS_WIRE_VALUE],
    );
    expect(fixture.resolveByAccessCredentialDigest).not.toHaveBeenCalled();
  });

  it.each([
    ['persistence failure', new IdentityAccessAuthorityPersistenceError()],
    ['authority corruption', new InvalidIdentityAuthenticatedPrincipalError()],
    ['unexpected adapter failure', new Error('authority-adapter-secret')],
    [
      'subclassed authority-unavailable error',
      new (class extends IdentityAccessAuthorityUnavailableError {})(),
    ],
  ] as const)('treats %s as an internal failure rather than rejection', async (_label, error) => {
    const fixture = resolverFixture();
    fixture.resolveByAccessCredentialDigest.mockRejectedValue(error);

    await expectInternalFailure(
      () => fixture.resolver.execute(ACCESS_WIRE_VALUE),
      [error.message, ACCESS_WIRE_VALUE],
    );
  });

  it.each([
    ['a structural object', Object.freeze({})],
    ['raw digest bytes', new Uint8Array(32)],
    ['a cloned digest wrapper', structuredClone(accessCredentialDigest())],
  ] as const)('rejects %s returned by cryptography before persistence', async (_label, digest) => {
    const fixture = resolverFixture();
    fixture.digestAccessCredential.mockResolvedValue(
      digest as unknown as IdentityAccessCredentialDigest,
    );

    await expectInternalFailure(() => fixture.resolver.execute(ACCESS_WIRE_VALUE));
    expect(fixture.resolveByAccessCredentialDigest).not.toHaveBeenCalled();
  });

  it('does not expose the digest validator error as part of the resolver contract', async (): Promise<void> => {
    const fixture = resolverFixture();
    fixture.digestAccessCredential.mockRejectedValue(
      new InvalidIdentityAccessCredentialDigestError(),
    );

    const error = await expectInternalFailure(() => fixture.resolver.execute(ACCESS_WIRE_VALUE));
    expect(error).not.toBeInstanceOf(InvalidIdentityAccessCredentialDigestError);
  });
});

describe('ResolveIdentityBearerPrincipal authority authenticity', (): void => {
  it('accepts an exact frozen data-only rejection without requiring singleton identity', async (): Promise<void> => {
    const fixture = resolverFixture();
    fixture.resolveByAccessCredentialDigest.mockResolvedValue(Object.freeze({ kind: 'rejected' }));

    const result = await fixture.resolver.execute(ACCESS_WIRE_VALUE);

    expect(result).toEqual({ kind: 'rejected' });
    expect(result).not.toBe(IDENTITY_ACCESS_AUTHORITY_REJECTED);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ['an unfrozen rejection', { kind: 'rejected' as const }],
    ['a rejection with an extra member', Object.freeze({ kind: 'rejected' as const, extra: true })],
    [
      'an unfrozen resolved record',
      { kind: 'resolved' as const, principal: authenticatedPrincipal() },
    ],
    [
      'a resolved record with an extra member',
      Object.freeze({
        kind: 'resolved' as const,
        principal: authenticatedPrincipal(),
        extra: true,
      }),
    ],
    [
      'a null-prototype resolved record',
      Object.freeze(
        Object.assign(Object.create(null) as Record<string, unknown>, {
          kind: 'resolved',
          principal: authenticatedPrincipal(),
        }),
      ),
    ],
    [
      'a structurally forged principal',
      Object.freeze({
        kind: 'resolved' as const,
        principal: Object.freeze({
          actorId: ACTOR_ID,
          sessionId: SESSION_ID,
          permissions: Object.freeze(['catalog.products.read']),
        }),
      }),
    ],
    [
      'a structured clone of an authentic principal',
      Object.freeze({
        kind: 'resolved' as const,
        principal: structuredClone(authenticatedPrincipal()),
      }),
    ],
  ] as const)('fails closed on %s', async (_label, malformedAuthority) => {
    const fixture = resolverFixture();
    fixture.resolveByAccessCredentialDigest.mockResolvedValue(
      malformedAuthority as unknown as IdentityAccessAuthorityResult,
    );

    await expectInternalFailure(() => fixture.resolver.execute(ACCESS_WIRE_VALUE));
  });

  it('rejects accessor authority members without invoking them', async (): Promise<void> => {
    let accessorCalls = 0;
    const malformedAuthority = Object.freeze(
      Object.defineProperties(
        {},
        {
          kind: {
            configurable: false,
            enumerable: true,
            get(): string {
              accessorCalls += 1;
              return 'resolved';
            },
          },
          principal: {
            configurable: false,
            enumerable: true,
            get(): unknown {
              accessorCalls += 1;
              return authenticatedPrincipal();
            },
          },
        },
      ),
    );
    const fixture = resolverFixture();
    fixture.resolveByAccessCredentialDigest.mockResolvedValue(
      malformedAuthority as unknown as IdentityAccessAuthorityResult,
    );

    await expectInternalFailure(() => fixture.resolver.execute(ACCESS_WIRE_VALUE));
    expect(accessorCalls).toBe(0);
  });

  it('rejects an accessor rejection member without invoking it', async (): Promise<void> => {
    let accessorCalls = 0;
    const malformedAuthority = Object.freeze(
      Object.defineProperty({}, 'kind', {
        configurable: false,
        enumerable: true,
        get(): string {
          accessorCalls += 1;
          return 'rejected';
        },
      }),
    );
    const fixture = resolverFixture();
    fixture.resolveByAccessCredentialDigest.mockResolvedValue(
      malformedAuthority as unknown as IdentityAccessAuthorityResult,
    );

    await expectInternalFailure(() => fixture.resolver.execute(ACCESS_WIRE_VALUE));
    expect(accessorCalls).toBe(0);
  });
});

describe('ResolveIdentityBearerPrincipal construction boundary', (): void => {
  it('captures exact dependency methods and preserves their receivers', async (): Promise<void> => {
    const fixture = resolverFixture(resolvedAuthority());
    const capturedDigestMethod = fixture.digestAccessCredential;
    const capturedReaderMethod = fixture.resolveByAccessCredentialDigest;

    fixture.credentialDigester.digestAccessCredential =
      (): Promise<IdentityAccessCredentialDigest> =>
        Promise.reject(new Error('mutated digester method'));
    fixture.authorityReader.resolveByAccessCredentialDigest =
      (): Promise<IdentityAccessAuthorityResult> =>
        Promise.reject(new Error('mutated reader method'));

    await expect(fixture.resolver.execute(ACCESS_WIRE_VALUE)).resolves.toMatchObject({
      kind: 'resolved',
    });
    expect(capturedDigestMethod).toHaveBeenCalledTimes(1);
    expect(capturedReaderMethod).toHaveBeenCalledTimes(1);
    expect(capturedDigestMethod.mock.contexts[0]).toBe(fixture.credentialDigester);
    expect(capturedReaderMethod.mock.contexts[0]).toBe(fixture.authorityReader);
  });

  it.each([
    ['missing digester', null, {}],
    ['missing digest method', {}, {}],
    ['non-callable digest method', { digestAccessCredential: true }, {}],
    ['missing reader', { digestAccessCredential: (): void => undefined }, null],
    ['missing reader method', { digestAccessCredential: (): void => undefined }, {}],
    [
      'non-callable reader method',
      { digestAccessCredential: (): void => undefined },
      { resolveByAccessCredentialDigest: true },
    ],
  ] as const)('rejects %s with one fixed synchronous error', (_label, digester, reader) => {
    const error = captureSynchronousError(
      () =>
        new ResolveIdentityBearerPrincipal(
          digester as unknown as CredentialDigester,
          reader as unknown as IdentityAccessAuthorityReader,
        ),
    );

    expectFixedError(
      error,
      IdentityBearerResolutionError,
      'IdentityBearerResolutionError',
      INTERNAL_FAILURE_MESSAGE,
    );
  });

  it('rejects a throwing dependency getter without retaining its secret', (): void => {
    const secret = 'dependency-getter-secret';
    const digester = Object.defineProperty({}, 'digestAccessCredential', {
      get(): never {
        throw new Error(secret);
      },
    });
    const fixture = resolverFixture();
    const error = captureSynchronousError(
      () =>
        new ResolveIdentityBearerPrincipal(digester as CredentialDigester, fixture.authorityReader),
    );

    expectFixedError(
      error,
      IdentityBearerResolutionError,
      'IdentityBearerResolutionError',
      INTERNAL_FAILURE_MESSAGE,
      [secret],
    );
  });

  it('freezes each instance and rejects an unregistered execute receiver', async (): Promise<void> => {
    const fixture = resolverFixture();

    const forgedReceiver = Object.freeze({}) as ResolveIdentityBearerPrincipal;
    const executeWithForgedReceiver = fixture.resolver.execute.bind(forgedReceiver);
    await expectInternalFailure(() => executeWithForgedReceiver(ACCESS_WIRE_VALUE));
    expect(Object.isFrozen(fixture.resolver)).toBe(true);
  });
});
