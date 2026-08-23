import * as identityPublicApi from '../src';
import {
  consumeIdentitySessionRefreshDiscoveryFoundTicket,
  createIdentitySessionRefreshDiscoveryBoundaryAuthority,
  createIdentitySessionRefreshDiscoveryFoundTicket,
  IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
  IdentitySessionRefreshDiscoveryUnavailableError,
  InvalidIdentitySessionRefreshDiscoveryTicketError,
  type IdentitySessionRefreshDiscovery,
  type IdentitySessionRefreshDiscoveryBoundaryAuthority,
  type IdentitySessionRefreshDiscoveryFoundTicket,
} from '../src/application/identity-session-refresh-discovery';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  copyIdentityRefreshCredentialDigestBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../src/application/identity-session-credential-digest.values';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const OTHER_SESSION_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const OTHER_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const INVALID_TICKET_MESSAGE = 'Expected a valid Identity session refresh discovery ticket';

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function digestBytes(seed = 19): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_unused, index): number => (seed + index * 29) & 0xff);
}

function refreshDigest(seed = 19): IdentityRefreshCredentialDigest {
  return createIdentityRefreshCredentialDigestFromBytes(digestBytes(seed));
}

function projection(
  overrides: Partial<{
    accountId: unknown;
    sessionId: unknown;
    presentedRefreshCredentialId: unknown;
  }> = {},
): Readonly<{
  accountId: unknown;
  sessionId: unknown;
  presentedRefreshCredentialId: unknown;
}> {
  return {
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    presentedRefreshCredentialId: CREDENTIAL_ID,
    ...overrides,
  };
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

function expectFixedError(
  operation: () => unknown,
  ErrorClass: ErrorClass = InvalidIdentitySessionRefreshDiscoveryTicketError,
  message = INVALID_TICKET_MESSAGE,
  rejectedValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(ErrorClass);
  expect(error).toMatchObject({ name: ErrorClass.name, message });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

describe('Identity refresh discovery result contract', (): void => {
  it('exposes one exact frozen not-found result', (): void => {
    expect(IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND).toEqual({ kind: 'not-found' });
    expect(Object.keys(IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND)).toEqual(['kind']);
    expect(Reflect.ownKeys(IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND)).toEqual(['kind']);
    expect(Object.isFrozen(IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND)).toBe(true);
  });

  it('creates an exact frozen found ticket with no digest or hidden enumerable brand', (): void => {
    const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const digest = refreshDigest();
    const ticket = createIdentitySessionRefreshDiscoveryFoundTicket(
      authority,
      digest,
      projection(),
    );

    expect(ticket).toEqual({
      kind: 'found',
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    });
    expect(Object.keys(ticket)).toEqual([
      'kind',
      'accountId',
      'sessionId',
      'presentedRefreshCredentialId',
    ]);
    expect(Reflect.ownKeys(ticket)).toEqual([
      'kind',
      'accountId',
      'sessionId',
      'presentedRefreshCredentialId',
    ]);
    expect(Object.getOwnPropertySymbols(ticket)).toEqual([]);
    expect(Object.getPrototypeOf(ticket)).toBe(Object.prototype);
    expect(Object.isFrozen(ticket)).toBe(true);
    expect(JSON.stringify(ticket)).toBe(
      `{"kind":"found","accountId":"${ACCOUNT_ID}","sessionId":"${SESSION_ID}","presentedRefreshCredentialId":"${CREDENTIAL_ID}"}`,
    );
    expect(JSON.stringify(ticket)).not.toContain(Buffer.from(digestBytes()).toString('hex'));
  });

  it('uses one empty frozen runtime-authentic boundary authority', (): void => {
    const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();

    expect(Object.keys(authority)).toEqual([]);
    expect(Reflect.ownKeys(authority)).toEqual([]);
    expect(Object.getOwnPropertySymbols(authority)).toEqual([]);
    expect(Object.getPrototypeOf(authority)).toBe(Object.prototype);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(JSON.stringify(authority)).toBe('{}');
  });

  it('copies a valid projection Proxy into an ordinary immutable ticket', (): void => {
    const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const source = {
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    };
    const proxiedProjection = new Proxy(source, {});
    const ticket = createIdentitySessionRefreshDiscoveryFoundTicket(
      authority,
      refreshDigest(),
      proxiedProjection,
    );

    source.accountId = OTHER_ACCOUNT_ID;
    source.sessionId = OTHER_SESSION_ID;
    source.presentedRefreshCredentialId = OTHER_CREDENTIAL_ID;

    expect(ticket).toEqual({
      kind: 'found',
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    });
    expect(Object.getPrototypeOf(ticket)).toBe(Object.prototype);
  });
});

describe('Identity refresh discovery ticket validation', (): void => {
  it.each([
    ['null projection', null],
    ['array projection', [ACCOUNT_ID, SESSION_ID, CREDENTIAL_ID]],
    ['missing account', { sessionId: SESSION_ID, presentedRefreshCredentialId: CREDENTIAL_ID }],
    ['missing session', { accountId: ACCOUNT_ID, presentedRefreshCredentialId: CREDENTIAL_ID }],
    ['missing credential', { accountId: ACCOUNT_ID, sessionId: SESSION_ID }],
    ['extra member', { ...projection(), secret: 'projection-extra-secret' }],
    ['discriminator from the public ticket', { kind: 'found', ...projection() }],
    ['invalid account', projection({ accountId: 'projection-account-secret' })],
    ['invalid session', projection({ sessionId: 'projection-session-secret' })],
    [
      'invalid credential',
      projection({ presentedRefreshCredentialId: 'projection-credential-secret' }),
    ],
  ] as const)('rejects %s with one fixed cause-free error', (_scenario, value): void => {
    expectFixedError(
      () =>
        createIdentitySessionRefreshDiscoveryFoundTicket(
          createIdentitySessionRefreshDiscoveryBoundaryAuthority(),
          refreshDigest(),
          value,
        ),
      InvalidIdentitySessionRefreshDiscoveryTicketError,
      INVALID_TICKET_MESSAGE,
      [
        'projection-extra-secret',
        'projection-account-secret',
        'projection-session-secret',
        'projection-credential-secret',
      ],
    );
  });

  it('rejects additional keys before reading projection values', (): void => {
    const secret = 'projection-getter-secret';
    let getterCalls = 0;
    const invalidProjection: Record<string, unknown> = {
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
      extra: true,
    };
    Object.defineProperty(invalidProjection, 'accountId', {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error(secret);
      },
    });

    expectFixedError(
      () =>
        createIdentitySessionRefreshDiscoveryFoundTicket(
          createIdentitySessionRefreshDiscoveryBoundaryAuthority(),
          refreshDigest(),
          invalidProjection,
        ),
      InvalidIdentitySessionRefreshDiscoveryTicketError,
      INVALID_TICKET_MESSAGE,
      [secret],
    );
    expect(getterCalls).toBe(0);
  });

  it('collapses hostile projections without coercing or leaking them', (): void => {
    const secret = 'hostile-discovery-projection-secret';
    let trapCalls = 0;
    let coercionCalls = 0;
    const throwingKeys = new Proxy(projection(), {
      ownKeys(): never {
        trapCalls += 1;
        throw new Error(secret);
      },
    });
    const throwingGet = new Proxy(projection(), {
      get(): never {
        trapCalls += 1;
        throw new Error(secret);
      },
    });
    const coercible = {
      ...projection(),
      toString(): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
    };

    for (const value of [throwingKeys, throwingGet, coercible]) {
      expectFixedError(
        () =>
          createIdentitySessionRefreshDiscoveryFoundTicket(
            createIdentitySessionRefreshDiscoveryBoundaryAuthority(),
            refreshDigest(),
            value,
          ),
        InvalidIdentitySessionRefreshDiscoveryTicketError,
        INVALID_TICKET_MESSAGE,
        [secret],
      );
    }

    expect(trapCalls).toBeGreaterThan(0);
    expect(coercionCalls).toBe(0);
  });

  it('requires authentic boundary authority and target-kind digest wrappers', (): void => {
    const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const digest = refreshDigest();
    const accessDigest = createIdentityAccessCredentialDigestFromBytes(digestBytes());
    const authorityProxy = new Proxy(authority, {});
    const authorityClone = structuredClone(authority);
    const revokedAuthority = Proxy.revocable(authority, {});
    const digestProxy = new Proxy(digest, {});
    const revokedDigest = Proxy.revocable(digest, {});
    revokedAuthority.revoke();
    revokedDigest.revoke();

    for (const invalidAuthority of [{}, authorityProxy, authorityClone, revokedAuthority.proxy]) {
      expectFixedError(() =>
        createIdentitySessionRefreshDiscoveryFoundTicket(
          invalidAuthority as IdentitySessionRefreshDiscoveryBoundaryAuthority,
          digest,
          projection(),
        ),
      );
    }

    for (const invalidDigest of [digestBytes(), accessDigest, digestProxy, revokedDigest.proxy]) {
      expectFixedError(() =>
        createIdentitySessionRefreshDiscoveryFoundTicket(
          authority,
          invalidDigest as IdentityRefreshCredentialDigest,
          projection(),
        ),
      );
    }
  });
});

describe('Identity refresh discovery one-shot consumption', (): void => {
  it('returns the exact private binding once to the matching authority', (): void => {
    const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const digest = refreshDigest();
    const ticket = createIdentitySessionRefreshDiscoveryFoundTicket(
      authority,
      digest,
      projection(),
    );
    const consumed = consumeIdentitySessionRefreshDiscoveryFoundTicket(authority, ticket);

    expect(consumed).toEqual({
      refreshCredentialDigest: digest,
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    });
    expect(consumed.refreshCredentialDigest).toBe(digest);
    expect(Object.keys(consumed)).toEqual([
      'refreshCredentialDigest',
      'accountId',
      'sessionId',
      'presentedRefreshCredentialId',
    ]);
    expect(Object.isFrozen(consumed)).toBe(true);
    expect(copyIdentityRefreshCredentialDigestBytes(consumed.refreshCredentialDigest)).toEqual(
      digestBytes(),
    );
    expectFixedError(() => consumeIdentitySessionRefreshDiscoveryFoundTicket(authority, ticket));
  });

  it('rejects clones, Proxies, forgeries, mixed records, and revoked Proxies before query', (): void => {
    const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const first = createIdentitySessionRefreshDiscoveryFoundTicket(
      authority,
      refreshDigest(),
      projection(),
    );
    const second = createIdentitySessionRefreshDiscoveryFoundTicket(
      authority,
      refreshDigest(83),
      projection({
        accountId: OTHER_ACCOUNT_ID,
        sessionId: OTHER_SESSION_ID,
        presentedRefreshCredentialId: OTHER_CREDENTIAL_ID,
      }),
    );
    const clone = structuredClone(first);
    const proxy = new Proxy(first, {});
    const forged = Object.freeze({ ...first });
    const mixed = Object.freeze({
      kind: 'found' as const,
      accountId: first.accountId,
      sessionId: second.sessionId,
      presentedRefreshCredentialId: first.presentedRefreshCredentialId,
    });
    const revoked = Proxy.revocable(first, {});
    revoked.revoke();
    let queryCalls = 0;
    const consumeThenQuery = (value: unknown): void => {
      consumeIdentitySessionRefreshDiscoveryFoundTicket(
        authority,
        value as IdentitySessionRefreshDiscoveryFoundTicket,
      );
      queryCalls += 1;
    };

    for (const invalid of [clone, proxy, forged, mixed, revoked.proxy, null]) {
      expectFixedError((): void => {
        consumeThenQuery(invalid);
      });
    }

    expect(queryCalls).toBe(0);
    consumeThenQuery(first);
    expect(queryCalls).toBe(1);
    expectFixedError((): void => {
      consumeThenQuery(first);
    });
    expect(queryCalls).toBe(1);
  });

  it('makes a foreign-authority consume side-effect free for the rightful consumer', (): void => {
    const owner = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const foreign = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const digest = refreshDigest();
    const ticket = createIdentitySessionRefreshDiscoveryFoundTicket(owner, digest, projection());
    let queryCalls = 0;

    expectFixedError(() => {
      consumeIdentitySessionRefreshDiscoveryFoundTicket(foreign, ticket);
      queryCalls += 1;
    });
    expect(queryCalls).toBe(0);

    const consumed = consumeIdentitySessionRefreshDiscoveryFoundTicket(owner, ticket);
    queryCalls += 1;
    expect(consumed.refreshCredentialDigest).toBe(digest);
    expect(queryCalls).toBe(1);
  });

  it('does not inspect hostile invalid ticket values', (): void => {
    const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    const secret = 'hostile-discovery-ticket-secret';
    let trapCalls = 0;
    let coercionCalls = 0;
    const hostile = new Proxy(
      {
        toString(): never {
          coercionCalls += 1;
          throw new Error(secret);
        },
      },
      {
        get(): never {
          trapCalls += 1;
          throw new Error(secret);
        },
        ownKeys(): never {
          trapCalls += 1;
          throw new Error(secret);
        },
      },
    );

    expectFixedError(
      () =>
        consumeIdentitySessionRefreshDiscoveryFoundTicket(
          authority,
          hostile as unknown as IdentitySessionRefreshDiscoveryFoundTicket,
        ),
      InvalidIdentitySessionRefreshDiscoveryTicketError,
      INVALID_TICKET_MESSAGE,
      [secret],
    );
    expect(trapCalls).toBe(0);
    expect(coercionCalls).toBe(0);
  });
});

describe('Identity refresh discovery port and errors', (): void => {
  it('passes an authentic refresh digest to the non-locking port', async (): Promise<void> => {
    const expected = refreshDigest();
    let observed: IdentityRefreshCredentialDigest | undefined;
    const discovery: IdentitySessionRefreshDiscovery = {
      findByRefreshCredentialDigest(
        refreshCredentialDigest: IdentityRefreshCredentialDigest,
      ): Promise<typeof IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND> {
        observed = refreshCredentialDigest;
        copyIdentityRefreshCredentialDigestBytes(refreshCredentialDigest).fill(0);

        return Promise.resolve(IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND);
      },
    };

    await expect(discovery.findByRefreshCredentialDigest(expected)).resolves.toBe(
      IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
    );
    expect(observed).toBe(expected);
  });

  it('defines one fixed cause-free unavailable error', (): void => {
    expectFixedError(
      () => {
        throw new IdentitySessionRefreshDiscoveryUnavailableError();
      },
      IdentitySessionRefreshDiscoveryUnavailableError,
      'Identity session refresh discovery is temporarily unavailable',
    );
  });

  it('does not widen the Identity package root', (): void => {
    for (const exportName of [
      'IdentitySessionRefreshDiscoveryUnavailableError',
      'InvalidIdentitySessionRefreshDiscoveryTicketError',
      'IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND',
      'createIdentitySessionRefreshDiscoveryBoundaryAuthority',
      'createIdentitySessionRefreshDiscoveryFoundTicket',
      'consumeIdentitySessionRefreshDiscoveryFoundTicket',
    ]) {
      expect(identityPublicApi).not.toHaveProperty(exportName);
    }
  });
});

function compileOnlyRefreshDiscoveryNominality(
  discovery: IdentitySessionRefreshDiscovery,
  accessDigest: IdentityAccessCredentialDigest,
): void {
  const structuralAuthority = {};
  const structuralTicket = {
    kind: 'found' as const,
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    presentedRefreshCredentialId: CREDENTIAL_ID,
  };

  // @ts-expect-error Boundary authority cannot be created structurally.
  const invalidAuthority: IdentitySessionRefreshDiscoveryBoundaryAuthority = structuralAuthority;
  // @ts-expect-error Found tickets require private runtime authority.
  const invalidTicket: IdentitySessionRefreshDiscoveryFoundTicket = structuralTicket;
  // @ts-expect-error Access digests cannot be presented to refresh discovery.
  const invalidLookup = discovery.findByRefreshCredentialDigest(accessDigest);

  void invalidAuthority;
  void invalidTicket;
  void invalidLookup;
}
void compileOnlyRefreshDiscoveryNominality;
