import { InvalidIdentityAuthenticatedPrincipalError } from '../../src/application/identity-authenticated-principal.errors';
import { mapIdentityAuthorityProjectionRows } from '../../src/infrastructure/identity-authority-projection.mapper';

const ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const OTHER_ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ac';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const ROLE_ONE_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const ROLE_TWO_ID = '01890f3a-8bcd-7def-aabc-0123456789ac';

type AuthorityRow = Readonly<{
  authority_state: unknown;
  actor_id: unknown;
  session_id: unknown;
  assigned_role_id: unknown;
  loaded_role_id: unknown;
  role_status: unknown;
  mapped_permission_code: unknown;
  permission_code: unknown;
}>;

function resolvedRow(overrides: Partial<AuthorityRow> = {}): AuthorityRow {
  return {
    authority_state: 'RESOLVED',
    actor_id: ACTOR_ID,
    session_id: SESSION_ID,
    assigned_role_id: ROLE_ONE_ID,
    loaded_role_id: ROLE_ONE_ID,
    role_status: 'ACTIVE',
    mapped_permission_code: 'catalog.products.read',
    permission_code: 'catalog.products.read',
    ...overrides,
  };
}

function rejectedRow(overrides: Partial<AuthorityRow> = {}): AuthorityRow {
  return {
    authority_state: 'REJECTED',
    actor_id: null,
    session_id: null,
    assigned_role_id: null,
    loaded_role_id: null,
    role_status: null,
    mapped_permission_code: null,
    permission_code: null,
    ...overrides,
  };
}

function noRoleRow(): AuthorityRow {
  return resolvedRow({
    assigned_role_id: null,
    loaded_role_id: null,
    role_status: null,
    mapped_permission_code: null,
    permission_code: null,
  });
}

function permissionCode(index: number): string {
  return `catalog.test.permission-${String(index).padStart(3, '0')}`;
}

function roleId(index: number): string {
  return `01890f3a-8bcd-7def-aabc-${String(index).padStart(12, '0')}`;
}

function expectInvalid(value: unknown): void {
  expect(() => mapIdentityAuthorityProjectionRows(value)).toThrow(
    InvalidIdentityAuthenticatedPrincipalError,
  );
}

function restoreOwnProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    if (!Reflect.deleteProperty(target, key)) {
      throw new Error('Expected poisoned prototype property to be removable');
    }

    return;
  }

  Object.defineProperty(target, key, descriptor);
}

describe('Identity authority projection mapper', (): void => {
  it('returns one frozen provider-independent raw projection with canonical authority', (): void => {
    const result = mapIdentityAuthorityProjectionRows([
      resolvedRow({
        assigned_role_id: ROLE_TWO_ID,
        loaded_role_id: ROLE_TWO_ID,
        mapped_permission_code: 'catalog.skus.write',
        permission_code: 'catalog.skus.write',
      }),
      resolvedRow(),
      resolvedRow({
        assigned_role_id: ROLE_TWO_ID,
        loaded_role_id: ROLE_TWO_ID,
        mapped_permission_code: 'catalog.products.read',
        permission_code: 'catalog.products.read',
      }),
    ]);

    expect(result).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 2,
        permissions: ['catalog.products.read', 'catalog.skus.write'],
      },
    });

    if (result.kind !== 'resolved') throw new Error('Expected resolved authority');
    expect(Reflect.ownKeys(result)).toEqual(['kind', 'projection']);
    expect(Reflect.ownKeys(result.projection)).toEqual([
      'actorId',
      'sessionId',
      'activeRoleCount',
      'permissions',
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.projection)).toBe(true);
    expect(Object.isFrozen(result.projection.permissions)).toBe(true);
  });

  it.each([
    ['no rows', []],
    ['one classified rejection', [rejectedRow()]],
  ])('returns the same frozen kind-only rejection for %s', (_label, rows): void => {
    const first = mapIdentityAuthorityProjectionRows(rows);
    const second = mapIdentityAuthorityProjectionRows(rows);

    expect(first).toEqual({ kind: 'rejected' });
    expect(first).toBe(second);
    expect(Reflect.ownKeys(first)).toEqual(['kind']);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each([
    ['no role assignments', [noRoleRow()]],
    [
      'only a retired role',
      [
        resolvedRow({
          role_status: 'RETIRED',
          mapped_permission_code: null,
          permission_code: null,
        }),
      ],
    ],
  ])('resolves %s without granting permissions', (_label, rows): void => {
    expect(mapIdentityAuthorityProjectionRows(rows)).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 0,
        permissions: [],
      },
    });
  });

  it('accepts exact frozen normalized arrays and rows without requiring provider mutability', (): void => {
    const rows = Object.freeze([Object.freeze({ ...noRoleRow() })]);

    expect(mapIdentityAuthorityProjectionRows(rows)).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 0,
        permissions: [],
      },
    });
  });

  it.each([
    ['corrupt state', [rejectedRow({ authority_state: 'CORRUPT' })]],
    ['unknown state', [rejectedRow({ authority_state: 'UNKNOWN' })]],
    ['rejection with data', [rejectedRow({ actor_id: ACTOR_ID })]],
    ['multiple rejection rows', [rejectedRow(), rejectedRow()]],
    ['mixed actor identity', [resolvedRow(), resolvedRow({ actor_id: OTHER_ACTOR_ID })]],
    ['missing loaded role', [resolvedRow({ loaded_role_id: null })]],
    ['unknown role state', [resolvedRow({ role_status: 'DISABLED' })]],
    ['mapping without registry evidence', [resolvedRow({ permission_code: null })]],
    ['duplicate role mapping', [resolvedRow(), resolvedRow()]],
    [
      'active role with empty and mapped projections',
      [resolvedRow({ mapped_permission_code: null, permission_code: null }), resolvedRow()],
    ],
  ])('fails closed on %s', (_label, rows): void => {
    expectInvalid(rows);
  });

  it('enforces the active-role, permission, and raw-row bounds independently', (): void => {
    const tooManyRoles = Array.from({ length: 17 }, (_value, index): AuthorityRow =>
      resolvedRow({
        assigned_role_id: roleId(index),
        loaded_role_id: roleId(index),
        mapped_permission_code: null,
        permission_code: null,
      }),
    );
    const tooManyPermissions = Array.from({ length: 129 }, (_value, index): AuthorityRow => {
      const permission = permissionCode(index);
      return resolvedRow({
        mapped_permission_code: permission,
        permission_code: permission,
      });
    });

    expectInvalid(tooManyRoles);
    expectInvalid(tooManyPermissions);
    expectInvalid(Array.from({ length: 2_049 }, noRoleRow));
  });

  it('keeps exact authority counts and bounds when Set size is polluted after import', (): void => {
    const validRows = [
      resolvedRow(),
      resolvedRow({
        assigned_role_id: ROLE_TWO_ID,
        loaded_role_id: ROLE_TWO_ID,
        mapped_permission_code: 'catalog.skus.write',
        permission_code: 'catalog.skus.write',
      }),
    ];
    const tooManyRoles = Array.from({ length: 17 }, (_value, index): AuthorityRow =>
      resolvedRow({
        assigned_role_id: roleId(index),
        loaded_role_id: roleId(index),
        mapped_permission_code: null,
        permission_code: null,
      }),
    );
    const tooManyPermissions = Array.from({ length: 129 }, (_value, index): AuthorityRow => {
      const permission = permissionCode(index);
      return resolvedRow({
        mapped_permission_code: permission,
        permission_code: permission,
      });
    });
    const sizeDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, 'size');

    if (sizeDescriptor?.get === undefined) throw new Error('Expected Set size getter');
    let sizeReads = 0;
    let validResult: ReturnType<typeof mapIdentityAuthorityProjectionRows> | undefined;
    let roleOverflowError: unknown;
    let permissionOverflowError: unknown;

    Object.defineProperty(Set.prototype, 'size', {
      ...sizeDescriptor,
      get(): number {
        sizeReads += 1;
        return 0;
      },
    });

    try {
      validResult = mapIdentityAuthorityProjectionRows(validRows);

      try {
        mapIdentityAuthorityProjectionRows(tooManyRoles);
      } catch (error) {
        roleOverflowError = error;
      }

      try {
        mapIdentityAuthorityProjectionRows(tooManyPermissions);
      } catch (error) {
        permissionOverflowError = error;
      }
    } finally {
      Object.defineProperty(Set.prototype, 'size', sizeDescriptor);
    }

    expect(validResult).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 2,
        permissions: ['catalog.products.read', 'catalog.skus.write'],
      },
    });
    expect(roleOverflowError).toBeInstanceOf(InvalidIdentityAuthenticatedPrincipalError);
    expect(permissionOverflowError).toBeInstanceOf(InvalidIdentityAuthenticatedPrincipalError);
    expect(sizeReads).toBe(0);
  });

  it('does not invoke inherited Object or Array setters while normalizing authority', (): void => {
    const rows = [resolvedRow()];
    const objectPropertyDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'actor_id');
    const arrayPropertyDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let objectSetterCalls = 0;
    let arraySetterCalls = 0;
    let result: ReturnType<typeof mapIdentityAuthorityProjectionRows> | undefined;
    let failure: unknown;

    Object.defineProperty(Object.prototype, 'actor_id', {
      configurable: true,
      enumerable: false,
      set(value: unknown): void {
        void value;
        objectSetterCalls += 1;
      },
    });
    Object.defineProperty(Array.prototype, '0', {
      configurable: true,
      enumerable: false,
      set(value: unknown): void {
        void value;
        arraySetterCalls += 1;
      },
    });

    try {
      result = mapIdentityAuthorityProjectionRows(rows);
    } catch (error: unknown) {
      failure = error;
    } finally {
      try {
        restoreOwnProperty(Array.prototype, '0', arrayPropertyDescriptor);
      } finally {
        restoreOwnProperty(Object.prototype, 'actor_id', objectPropertyDescriptor);
      }
    }

    expect(failure).toBeUndefined();
    expect(result).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 1,
        permissions: ['catalog.products.read'],
      },
    });
    expect(objectSetterCalls).toBe(0);
    expect(arraySetterCalls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'actor_id')).toEqual(
      objectPropertyDescriptor,
    );
    expect(Object.getOwnPropertyDescriptor(Array.prototype, '0')).toEqual(arrayPropertyDescriptor);
  });

  it('does not resolve the mutable global String binding while normalizing rows', (): void => {
    const stringDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'String');

    if (stringDescriptor === undefined || typeof stringDescriptor.value !== 'function') {
      throw new Error('Expected global String constructor');
    }

    const rows = [
      resolvedRow(),
      resolvedRow({
        assigned_role_id: ROLE_TWO_ID,
        loaded_role_id: ROLE_TWO_ID,
        mapped_permission_code: 'catalog.skus.write',
        permission_code: 'catalog.skus.write',
      }),
    ];
    let stringCalls = 0;
    let result: ReturnType<typeof mapIdentityAuthorityProjectionRows> | undefined;
    let failure: unknown;

    Object.defineProperty(globalThis, 'String', {
      ...stringDescriptor,
      value(): string {
        stringCalls += 1;
        return '0';
      },
    });

    try {
      result = mapIdentityAuthorityProjectionRows(rows);
    } catch (error: unknown) {
      failure = error;
    } finally {
      restoreOwnProperty(globalThis, 'String', stringDescriptor);
    }

    expect(failure).toBeUndefined();
    expect(result).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 2,
        permissions: ['catalog.products.read', 'catalog.skus.write'],
      },
    });
    expect(stringCalls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'String')).toEqual(stringDescriptor);
  });

  it('uses captured Map and Set constructors for valid and over-limit authority', (): void => {
    const mapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Map');
    const setDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Set');

    if (
      mapDescriptor === undefined ||
      typeof mapDescriptor.value !== 'function' ||
      setDescriptor === undefined ||
      typeof setDescriptor.value !== 'function'
    ) {
      throw new Error('Expected global Map and Set constructors');
    }

    const OriginalMap = mapDescriptor.value as MapConstructor;
    const OriginalSet = setDescriptor.value as SetConstructor;
    const seededRoleIds = Array.from({ length: 17 }, (_value, index): string => roleId(index));
    const validRows = [
      resolvedRow(),
      resolvedRow({
        assigned_role_id: ROLE_TWO_ID,
        loaded_role_id: ROLE_TWO_ID,
        mapped_permission_code: 'catalog.skus.write',
        permission_code: 'catalog.skus.write',
      }),
    ];
    const tooManyRoles = seededRoleIds.map((seededRoleId): AuthorityRow =>
      resolvedRow({
        assigned_role_id: seededRoleId,
        loaded_role_id: seededRoleId,
        mapped_permission_code: null,
        permission_code: null,
      }),
    );
    let mapConstructorCalls = 0;
    let setConstructorCalls = 0;
    let validResult: ReturnType<typeof mapIdentityAuthorityProjectionRows> | undefined;
    let validFailure: unknown;
    let roleOverflowError: unknown;

    function ReboundMap(): Map<unknown, unknown> {
      mapConstructorCalls += 1;
      return new OriginalMap();
    }

    function ReboundSet(): Set<unknown> {
      setConstructorCalls += 1;
      const isActiveRoleSet = (setConstructorCalls - 1) % 3 === 0;

      return new OriginalSet(isActiveRoleSet ? seededRoleIds : []);
    }

    Object.defineProperty(globalThis, 'Map', {
      ...mapDescriptor,
      value: ReboundMap,
    });
    Object.defineProperty(globalThis, 'Set', {
      ...setDescriptor,
      value: ReboundSet,
    });

    try {
      try {
        validResult = mapIdentityAuthorityProjectionRows(validRows);
      } catch (error: unknown) {
        validFailure = error;
      }

      try {
        mapIdentityAuthorityProjectionRows(tooManyRoles);
      } catch (error: unknown) {
        roleOverflowError = error;
      }
    } finally {
      try {
        restoreOwnProperty(globalThis, 'Set', setDescriptor);
      } finally {
        restoreOwnProperty(globalThis, 'Map', mapDescriptor);
      }
    }

    expect(validFailure).toBeUndefined();
    expect(validResult).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 2,
        permissions: ['catalog.products.read', 'catalog.skus.write'],
      },
    });
    expect(roleOverflowError).toBeInstanceOf(InvalidIdentityAuthenticatedPrincipalError);
    expect(mapConstructorCalls).toBe(0);
    expect(setConstructorCalls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'Map')).toEqual(mapDescriptor);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'Set')).toEqual(setDescriptor);
  });

  it('rejects sparse, extended, exotic, and symbol-bearing provider arrays', (): void => {
    const sparse = new Array<AuthorityRow>(2);
    sparse[0] = resolvedRow();
    const extended = [resolvedRow()] as unknown[] & { metadata?: string };
    extended.metadata = 'secret-provider-metadata';
    const symbolBearing = [resolvedRow()] as unknown[] & Record<symbol, string>;
    symbolBearing[Symbol('secret')] = 'secret-provider-symbol';

    expectInvalid(sparse);
    expectInvalid(extended);
    expectInvalid(symbolBearing);
    expectInvalid(Object.setPrototypeOf([resolvedRow()], null));
  });

  it('rejects row accessors and Proxies without invoking their traps', (): void => {
    let trapCalls = 0;
    const accessorRow = resolvedRow() as Record<string, unknown>;
    Object.defineProperty(accessorRow, 'actor_id', {
      configurable: true,
      enumerable: true,
      get(): never {
        trapCalls += 1;
        throw new Error('authority-accessor-secret');
      },
    });
    const proxiedRow = new Proxy(resolvedRow(), {
      get(): never {
        trapCalls += 1;
        throw new Error('authority-proxy-secret');
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error('authority-proxy-secret');
      },
    });
    const proxiedRows = new Proxy([resolvedRow()], {
      get(): never {
        trapCalls += 1;
        throw new Error('rows-proxy-secret');
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error('rows-proxy-secret');
      },
    });

    expectInvalid([accessorRow]);
    expectInvalid([proxiedRow]);
    expectInvalid(proxiedRows);
    expect(trapCalls).toBe(0);
  });

  it('requires exact plain accessor-free row records', (): void => {
    const nonEnumerable = resolvedRow() as Record<string, unknown>;
    Object.defineProperty(nonEnumerable, 'actor_id', {
      configurable: true,
      enumerable: false,
      value: ACTOR_ID,
      writable: true,
    });

    expectInvalid([{ ...resolvedRow(), extra: 'secret-extra-field' }]);
    expectInvalid([Object.assign(Object.create(null), resolvedRow())]);
    expectInvalid([nonEnumerable]);
    expectInvalid([[resolvedRow()]]);
  });

  it('collapses malformed values to a fresh fixed cause-free error', (): void => {
    let first: unknown;
    let second: unknown;

    try {
      mapIdentityAuthorityProjectionRows({ secret: 'provider-secret' });
    } catch (error) {
      first = error;
    }

    try {
      mapIdentityAuthorityProjectionRows({ secret: 'provider-secret' });
    } catch (error) {
      second = error;
    }

    expect(first).toEqual(new InvalidIdentityAuthenticatedPrincipalError());
    expect(second).toEqual(new InvalidIdentityAuthenticatedPrincipalError());
    expect(first).not.toBe(second);
    expect(first).not.toHaveProperty('cause');
    expect(String(first)).not.toContain('provider-secret');
  });
});
