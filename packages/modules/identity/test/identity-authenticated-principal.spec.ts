import { InvalidIdentityAuthenticatedPrincipalError } from '../src/application/identity-authenticated-principal.errors';
import { createIdentityAuthenticatedPrincipalFromAuthority } from '../src/application/identity-authenticated-principal';

const ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const OTHER_ACTOR_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const READ_PRODUCTS = 'catalog.products.read';
const READ_SKUS = 'catalog.skus.read';

interface RawAuthorityEvidence {
  actorId: unknown;
  sessionId: unknown;
  activeRoleCount: unknown;
  permissions: unknown;
}

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function authorityEvidence(overrides: Partial<RawAuthorityEvidence> = {}): RawAuthorityEvidence {
  return {
    actorId: ACTOR_ID,
    sessionId: SESSION_ID,
    activeRoleCount: 1,
    permissions: [READ_PRODUCTS],
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

function expectFixedSafeError(
  operation: () => unknown,
  expectedClass: ErrorClass,
  rejectedValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

function maximumPermissionSet(): string[] {
  return Array.from(
    { length: 128 },
    (_, index) => `scope.resource-${String(index).padStart(3, '0')}.read`,
  );
}

function unreadablePermissionArray(
  length: number,
  secret: string,
): Readonly<{ permissions: string[]; indexedReads: () => number }> {
  let indexedReads = 0;
  const permissions: string[] = [];
  permissions.length = length;

  for (let index = 0; index < length; index += 1) {
    Object.defineProperty(permissions, index, {
      configurable: true,
      enumerable: true,
      get(): never {
        indexedReads += 1;
        throw new Error(secret);
      },
    });
  }

  return Object.freeze({ permissions, indexedReads: () => indexedReads });
}

describe('Identity authenticated principal authority boundary', (): void => {
  it('returns the exact canonical runtime shape in stable member order', (): void => {
    const principal = createIdentityAuthenticatedPrincipalFromAuthority({
      permissions: [READ_PRODUCTS, READ_SKUS],
      activeRoleCount: 2,
      sessionId: SESSION_ID,
      actorId: ACTOR_ID,
    });

    expect(principal).toEqual({
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      permissions: [READ_PRODUCTS, READ_SKUS],
    });
    expect(Object.keys(principal)).toEqual(['actorId', 'sessionId', 'permissions']);
    expect(Reflect.ownKeys(principal)).toEqual(['actorId', 'sessionId', 'permissions']);
    expect(Object.getOwnPropertySymbols(principal)).toEqual([]);
    expect('activeRoleCount' in principal).toBe(false);
  });

  it.each([
    ['no active roles and no permissions', 0, []],
    ['one empty active role', 1, []],
    ['sixteen empty active roles', 16, []],
  ] as const)('accepts %s', (_scenario, activeRoleCount, permissions): void => {
    const principal = createIdentityAuthenticatedPrincipalFromAuthority(
      authorityEvidence({ activeRoleCount, permissions: [...permissions] }),
    );

    expect(principal.permissions).toEqual([]);
  });

  it('accepts the exact maximum distinct sorted permission set', (): void => {
    const permissions = maximumPermissionSet();
    const principal = createIdentityAuthenticatedPrincipalFromAuthority(
      authorityEvidence({ activeRoleCount: 16, permissions }),
    );

    expect(principal.permissions).toEqual(permissions);
    expect(principal.permissions).toHaveLength(128);
    expect(principal.permissions).not.toBe(permissions);
    expect(Object.isFrozen(principal.permissions)).toBe(true);
  });

  it('rejects a seventeenth role before reading permission elements', (): void => {
    const secret = 'seventeenth-role-permission-secret';
    const guarded = unreadablePermissionArray(1, secret);

    expectFixedSafeError(
      () =>
        createIdentityAuthenticatedPrincipalFromAuthority(
          authorityEvidence({ activeRoleCount: 17, permissions: guarded.permissions }),
        ),
      InvalidIdentityAuthenticatedPrincipalError,
      [secret],
    );
    expect(guarded.indexedReads()).toBe(0);
  });

  it('rejects a 129th permission before reading any permission element', (): void => {
    const secret = 'oversized-permission-array-secret';
    const guarded = unreadablePermissionArray(129, secret);

    expectFixedSafeError(
      () =>
        createIdentityAuthenticatedPrincipalFromAuthority(
          authorityEvidence({ permissions: guarded.permissions }),
        ),
      InvalidIdentityAuthenticatedPrincipalError,
      [secret],
    );
    expect(guarded.indexedReads()).toBe(0);
  });

  it('rejects permissions when authority evidence reports zero active roles', (): void => {
    expectFixedSafeError(
      () =>
        createIdentityAuthenticatedPrincipalFromAuthority(
          authorityEvidence({ activeRoleCount: 0, permissions: [READ_PRODUCTS] }),
        ),
      InvalidIdentityAuthenticatedPrincipalError,
    );
  });

  it.each([
    ['negative role count', -1],
    ['fractional role count', 1.5],
    ['non-numeric role count', '1'],
    ['non-finite role count', Number.POSITIVE_INFINITY],
    ['not-a-number role count', Number.NaN],
  ])('rejects %s', (_scenario, activeRoleCount): void => {
    expectFixedSafeError(
      () =>
        createIdentityAuthenticatedPrincipalFromAuthority(authorityEvidence({ activeRoleCount })),
      InvalidIdentityAuthenticatedPrincipalError,
    );
  });

  it.each([
    [
      'invalid actor UUID version',
      authorityEvidence({ actorId: '01890f3a-8bcd-4def-8abc-0123456789ab' }),
    ],
    [
      'uppercase actor UUID',
      authorityEvidence({ actorId: '01890F3A-8BCD-7DEF-8ABC-0123456789AB' }),
    ],
    [
      'invalid session UUID variant',
      authorityEvidence({ sessionId: '01890f3a-8bcd-7def-7abc-0123456789ab' }),
    ],
    ['secret actor value', authorityEvidence({ actorId: 'authority-actor-secret' })],
    ['secret session value', authorityEvidence({ sessionId: 'authority-session-secret' })],
  ] as const)('rejects %s with one cause-free error', (_scenario, evidence): void => {
    expectFixedSafeError(
      () => createIdentityAuthenticatedPrincipalFromAuthority(evidence),
      InvalidIdentityAuthenticatedPrincipalError,
      ['authority-actor-secret', 'authority-session-secret'],
    );
  });

  it.each([
    ['uppercase permission', 'catalog.products.READ'],
    ['wildcard permission', 'catalog.products.*'],
    ['underscore permission', 'catalog.product_variants.read'],
    ['two-segment permission', 'catalog.read'],
    ['secret malformed permission', 'authority-permission-secret'],
  ])('rejects %s without exposing the code', (_scenario, permission): void => {
    expectFixedSafeError(
      () =>
        createIdentityAuthenticatedPrincipalFromAuthority(
          authorityEvidence({ permissions: [permission] }),
        ),
      InvalidIdentityAuthenticatedPrincipalError,
      [permission],
    );
  });

  it.each([
    ['duplicate permissions', [READ_PRODUCTS, READ_PRODUCTS]],
    ['unsorted permissions', [READ_SKUS, READ_PRODUCTS]],
  ] as const)(
    'rejects %s rather than repairing authority evidence',
    (_scenario, permissions): void => {
      expectFixedSafeError(
        () =>
          createIdentityAuthenticatedPrincipalFromAuthority(
            authorityEvidence({ permissions: [...permissions] }),
          ),
        InvalidIdentityAuthenticatedPrincipalError,
      );
    },
  );

  it.each([
    ['non-object evidence', null],
    ['array evidence', []],
    [
      'missing actor id',
      { sessionId: SESSION_ID, activeRoleCount: 1, permissions: [READ_PRODUCTS] },
    ],
    ['missing session id', { actorId: ACTOR_ID, activeRoleCount: 1, permissions: [READ_PRODUCTS] }],
    [
      'missing active-role count',
      { actorId: ACTOR_ID, sessionId: SESSION_ID, permissions: [READ_PRODUCTS] },
    ],
    ['missing permissions', { actorId: ACTOR_ID, sessionId: SESSION_ID, activeRoleCount: 1 }],
    [
      'additional evidence member',
      { ...authorityEvidence(), authoritySecret: 'authority-extra-secret' },
    ],
  ] as const)('rejects %s', (_scenario, evidence): void => {
    expectFixedSafeError(
      () => createIdentityAuthenticatedPrincipalFromAuthority(evidence),
      InvalidIdentityAuthenticatedPrincipalError,
      ['authority-extra-secret'],
    );
  });

  it.each([
    ['non-array permissions', new Set([READ_PRODUCTS])],
    ['string permissions', READ_PRODUCTS],
    ['null permissions', null],
  ])('rejects %s', (_scenario, permissions): void => {
    expectFixedSafeError(
      () => createIdentityAuthenticatedPrincipalFromAuthority(authorityEvidence({ permissions })),
      InvalidIdentityAuthenticatedPrincipalError,
    );
  });

  it('copies aliases, deeply freezes the public value, and serializes only public fields', (): void => {
    const permissions = [READ_PRODUCTS];
    const evidence = authorityEvidence({ permissions });
    const principal = createIdentityAuthenticatedPrincipalFromAuthority(evidence);

    expect(principal).not.toBe(evidence);
    expect(principal.permissions).not.toBe(permissions);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.permissions)).toBe(true);
    expect(JSON.stringify(principal)).toBe(
      `{"actorId":"${ACTOR_ID}","sessionId":"${SESSION_ID}","permissions":["${READ_PRODUCTS}"]}`,
    );

    evidence.actorId = OTHER_ACTOR_ID;
    permissions[0] = READ_SKUS;
    permissions.push('catalog.skus.write');

    expect(principal).toEqual({
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      permissions: [READ_PRODUCTS],
    });
    expect(() => {
      (principal as unknown as { actorId: string }).actorId = OTHER_ACTOR_ID;
    }).toThrow(TypeError);
    expect(() => {
      (principal.permissions as string[]).push(READ_SKUS);
    }).toThrow(TypeError);
  });

  it('allows actor and session namespaces to contain the same UUID bytes', (): void => {
    const principal = createIdentityAuthenticatedPrincipalFromAuthority(
      authorityEvidence({ actorId: SESSION_ID, sessionId: SESSION_ID }),
    );

    expect(principal.actorId).toBe(SESSION_ID);
    expect(principal.sessionId).toBe(SESSION_ID);
  });

  it('collapses throwing getters, throwing Proxy traps, and revoked Proxies safely', (): void => {
    const secret = 'hostile-authority-evidence-secret';
    let trapCalls = 0;
    const throwingGetter = authorityEvidence();
    Object.defineProperty(throwingGetter, 'actorId', {
      configurable: true,
      enumerable: true,
      get(): never {
        trapCalls += 1;
        throw new Error(secret);
      },
    });
    const throwingGetProxy = new Proxy(authorityEvidence(), {
      get(): never {
        trapCalls += 1;
        throw new Error(secret);
      },
    });
    const throwingKeysProxy = new Proxy(authorityEvidence(), {
      ownKeys(): never {
        trapCalls += 1;
        throw new Error(secret);
      },
    });
    const revoked = Proxy.revocable(authorityEvidence(), {});
    revoked.revoke();

    for (const evidence of [throwingGetter, throwingGetProxy, throwingKeysProxy, revoked.proxy]) {
      expectFixedSafeError(
        () => createIdentityAuthenticatedPrincipalFromAuthority(evidence),
        InvalidIdentityAuthenticatedPrincipalError,
        [secret],
      );
    }

    expect(trapCalls).toBeGreaterThan(0);
  });

  it('copies a valid-behaving evidence Proxy and nested permission Proxy into safe values', (): void => {
    const permissionTarget = [READ_PRODUCTS];
    const permissionProxy = new Proxy(permissionTarget, {});
    const evidenceTarget = authorityEvidence({ permissions: permissionProxy });
    const evidenceProxy = new Proxy(evidenceTarget, {});

    const principal = createIdentityAuthenticatedPrincipalFromAuthority(evidenceProxy);

    expect(principal).toEqual({
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      permissions: [READ_PRODUCTS],
    });
    expect(principal).not.toBe(evidenceProxy);
    expect(principal.permissions).not.toBe(permissionProxy);
    expect(Object.getPrototypeOf(principal)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(principal.permissions)).toBe(Array.prototype);

    evidenceTarget.actorId = OTHER_ACTOR_ID;
    permissionTarget[0] = READ_SKUS;

    expect(principal.actorId).toBe(ACTOR_ID);
    expect(principal.permissions).toEqual([READ_PRODUCTS]);
  });
});
