import {
  InvalidIdentityPermissionCodeError,
  MAX_IDENTITY_ROLE_PERMISSIONS,
} from '../src/domain/identity-permission.values';
import {
  IdentityRoleLifecycleConflictError,
  IdentityRolePermissionCapacityExceededError,
  IdentityRoleTimestampRegressionError,
  IdentityRoleVersionMismatchError,
  InvalidIdentityRolePermissionSetError,
  InvalidIdentityRoleStateError,
} from '../src/domain/identity-role.errors';
import {
  IdentityRole,
  type CreateIdentityRoleInput,
  type IdentityRoleSnapshot,
} from '../src/domain/identity-role';
import {
  IDENTITY_ROLE_STATUSES,
  InvalidIdentityRoleCodeError,
  InvalidIdentityRoleDisplayNameError,
  InvalidIdentityRoleIdError,
  InvalidIdentityRoleStatusError,
  MAX_IDENTITY_ROLE_CODE_LENGTH,
  MAX_IDENTITY_ROLE_DISPLAY_NAME_CODE_POINTS,
  MIN_IDENTITY_ROLE_CODE_LENGTH,
  parseIdentityRoleCode,
  parseIdentityRoleDisplayName,
  parseIdentityRoleId,
  parseIdentityRoleStatus,
} from '../src/domain/identity-role.values';
import {
  IdentityAggregateVersionExhaustedError,
  InvalidIdentityAggregateVersionError,
  InvalidIdentityInstantError,
  MAX_IDENTITY_AGGREGATE_VERSION,
} from '../src/domain/identity-values';

const ROLE_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const ROLE_CODE = 'CATALOG_PUBLISHER';
const DISPLAY_NAME = 'Catalog Publisher';
const RENAMED_DISPLAY_NAME = 'Senior Catalog Publisher';
const P_AUDIT_READ = 'audit.records.read';
const P_PRODUCT_READ = 'catalog.products.read';
const P_PRODUCT_WRITE = 'catalog.products.write';
const P_SKU_READ = 'catalog.skus.read';
const P_ORDER_READ = 'orders.items.read';
const T0 = '2026-08-23T10:00:00.000001Z';
const T1 = '2026-08-23T10:01:00.000002Z';
const T2 = '2026-08-23T10:02:00.000003Z';
const BEFORE_T0 = '2026-08-23T09:59:59.999999Z';
const SPARSE_PERMISSION_SET = Array<string>(1);

function inheritedPermissionSet(): string[] {
  const permissions = Array<string>(1);
  Object.setPrototypeOf(permissions, { 0: P_PRODUCT_READ });

  return permissions;
}

function growingPermissionSet(): string[] {
  const permissions = Array<string>(1);

  Object.defineProperty(permissions, '0', {
    configurable: true,
    enumerable: true,
    get: (): string => {
      permissions.length = MAX_IDENTITY_ROLE_PERMISSIONS + 1;

      for (let index = 1; index <= MAX_IDENTITY_ROLE_PERMISSIONS; index += 1) {
        permissions[index] = permissionCodeAt(index);
      }

      return permissionCodeAt(0);
    },
  });

  return permissions;
}

type RawRoleSnapshot = Readonly<{
  id: unknown;
  code: unknown;
  displayName: unknown;
  status: unknown;
  permissions: unknown;
  version: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  retiredAt: unknown;
}>;

type ErrorClass = abstract new (...arguments_: never[]) => Error;

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

function activeSnapshot(overrides: Partial<RawRoleSnapshot> = {}): RawRoleSnapshot {
  return {
    id: ROLE_ID,
    code: ROLE_CODE,
    displayName: DISPLAY_NAME,
    status: 'ACTIVE',
    permissions: [],
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    retiredAt: null,
    ...overrides,
  };
}

function retiredSnapshot(overrides: Partial<RawRoleSnapshot> = {}): RawRoleSnapshot {
  return activeSnapshot({
    status: 'RETIRED',
    version: 2,
    updatedAt: T1,
    retiredAt: T1,
    ...overrides,
  });
}

function createRole(permissions: readonly string[] = []): IdentityRole {
  return IdentityRole.create({
    id: ROLE_ID,
    code: ROLE_CODE,
    displayName: DISPLAY_NAME,
    permissions,
    occurredAt: T0,
  }).role;
}

function permissionCodeAt(index: number): string {
  return `identity.resource${String(index).padStart(3, '0')}.read`;
}

function permissionSet(size: number): readonly string[] {
  return Array.from({ length: size }, (_value, index) => permissionCodeAt(index));
}

function expectFrozenSafeFacts(facts: readonly object[]): void {
  expect(Object.isFrozen(facts)).toBe(true);

  for (const fact of facts) {
    expect(Object.isFrozen(fact)).toBe(true);
  }

  const serialized = JSON.stringify(facts);
  expect(serialized).not.toContain(ROLE_CODE);
  expect(serialized).not.toContain(DISPLAY_NAME);
  expect(serialized).not.toContain(RENAMED_DISPLAY_NAME);
  expect(serialized).not.toContain('displayName');
  expect(serialized).not.toContain('permissions');
}

function expectSafeImmutableRejection(
  role: IdentityRole,
  operation: () => unknown,
  expectedClass: ErrorClass,
): Error {
  const before = role.toSnapshot();
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  expect(String(error)).not.toContain(ROLE_ID);
  expect(String(error)).not.toContain(ROLE_CODE);
  expect(String(error)).not.toContain(DISPLAY_NAME);
  expect(String(error)).not.toContain(P_PRODUCT_READ);
  expect(JSON.stringify(error)).not.toContain(ROLE_ID);
  expect(JSON.stringify(error)).not.toContain(DISPLAY_NAME);
  expect(role.toSnapshot()).toBe(before);

  return error;
}

describe('Identity Role values', (): void => {
  it.each([
    '00000000-0000-7000-8000-000000000000',
    ROLE_ID,
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ])('retains canonical lowercase UUIDv7 Role id %s', (roleId): void => {
    expect(parseIdentityRoleId(roleId)).toBe(roleId);
  });

  it.each([
    '01890F3A-8BCD-7DEF-8ABC-0123456789AB',
    '01890f3a-8bcd-4def-8abc-0123456789ab',
    '01890f3a-8bcd-7def-7abc-0123456789ab',
    ' 01890f3a-8bcd-7def-8abc-0123456789ab',
    'not-a-role-id',
    null,
  ])('rejects noncanonical Role id %p', (roleId): void => {
    expect(() => parseIdentityRoleId(roleId)).toThrow(InvalidIdentityRoleIdError);
  });

  it.each(['ABC', 'A1_B2', ROLE_CODE, `A${'Z'.repeat(63)}`])(
    'retains canonical Role code %s',
    (code): void => {
      expect(parseIdentityRoleCode(code)).toBe(code);
    },
  );

  it.each([
    '',
    'A',
    'AB',
    `A${'Z'.repeat(64)}`,
    '1ADMIN',
    'Admin',
    '_ADMIN',
    'ADMIN_',
    'ADMIN__USER',
    'ADMIN-USER',
    'ADMIN.USER',
    'ADMIN USER',
    'ÁDMIN',
    null,
  ])('rejects noncanonical Role code %p', (code): void => {
    expect(() => parseIdentityRoleCode(code)).toThrow(InvalidIdentityRoleCodeError);
  });

  it.each([
    ['one code point', 'A'],
    ['single internal ASCII spaces', 'Catalog Senior Publisher'],
    ['NFC text', 'Café Publisher'],
    ['assigned astral characters', 'Operations 🛡'],
    ['maximum code points', '😀'.repeat(MAX_IDENTITY_ROLE_DISPLAY_NAME_CODE_POINTS)],
  ])('retains a display name with %s', (_scenario, displayName): void => {
    expect(parseIdentityRoleDisplayName(displayName)).toBe(displayName);
  });

  it.each([
    ['empty text', ''],
    ['too many code points', '😀'.repeat(MAX_IDENTITY_ROLE_DISPLAY_NAME_CODE_POINTS + 1)],
    ['decomposed non-NFC text', 'Cafe\u0301 Publisher'],
    ['leading ASCII space', ' Catalog Publisher'],
    ['trailing ASCII space', 'Catalog Publisher '],
    ['consecutive ASCII spaces', 'Catalog  Publisher'],
    ['interior tab', 'Catalog\tPublisher'],
    ['interior no-break space', 'Catalog\u00a0Publisher'],
    ['interior ideographic space', 'Catalog\u3000Publisher'],
    ['control character', 'Catalog\u0007Publisher'],
    ['format character', 'Catalog\u200bPublisher'],
    ['lone surrogate', 'Catalog\ud800Publisher'],
    ['private-use character', 'Catalog\ue000Publisher'],
    ['unassigned code point', 'Catalog\u0378Publisher'],
  ])('rejects a display name with %s without normalization', (_scenario, displayName): void => {
    expect(() => parseIdentityRoleDisplayName(displayName)).toThrow(
      InvalidIdentityRoleDisplayNameError,
    );
  });

  it.each([undefined, null, 7, {}, []])(
    'rejects non-string display name %p',
    (displayName): void => {
      expect(() => parseIdentityRoleDisplayName(displayName)).toThrow(
        InvalidIdentityRoleDisplayNameError,
      );
    },
  );

  it.each(IDENTITY_ROLE_STATUSES)('retains supported Role status %s', (status): void => {
    expect(parseIdentityRoleStatus(status)).toBe(status);
  });

  it.each(['active', 'SUSPENDED', ' ACTIVE', 'ACTIVE ', '', null, 7])(
    'rejects unsupported Role status %p',
    (status): void => {
      expect(() => parseIdentityRoleStatus(status)).toThrow(InvalidIdentityRoleStatusError);
    },
  );

  it('publishes frozen registries, exact bounds, and fixed safe errors', (): void => {
    const rejectedCode = 'customer-role-code';
    const rejectedName = ' Customer Role ';
    const codeError = captureError(() => parseIdentityRoleCode(rejectedCode));
    const nameError = captureError(() => parseIdentityRoleDisplayName(rejectedName));

    expect(MIN_IDENTITY_ROLE_CODE_LENGTH).toBe(3);
    expect(MAX_IDENTITY_ROLE_CODE_LENGTH).toBe(64);
    expect(MAX_IDENTITY_ROLE_DISPLAY_NAME_CODE_POINTS).toBe(100);
    expect(Object.isFrozen(IDENTITY_ROLE_STATUSES)).toBe(true);
    expect(codeError).toBeInstanceOf(InvalidIdentityRoleCodeError);
    expect(nameError).toBeInstanceOf(InvalidIdentityRoleDisplayNameError);
    expect(String(codeError)).not.toContain(rejectedCode);
    expect(String(nameError)).not.toContain(rejectedName);
    expect((codeError as Error & { cause?: unknown }).cause).toBeUndefined();
    expect((nameError as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

describe('IdentityRole creation and rehydration', (): void => {
  it('creates an empty Active Role and one frozen fact', (): void => {
    const result = IdentityRole.create({
      id: ROLE_ID,
      code: ROLE_CODE,
      displayName: DISPLAY_NAME,
      permissions: [],
      occurredAt: T0,
    });

    expect(result.role.toSnapshot()).toEqual(activeSnapshot());
    expect(result.facts).toEqual([
      {
        type: 'ROLE_CREATED',
        roleId: ROLE_ID,
        status: 'ACTIVE',
        version: 1,
        occurredAt: T0,
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.role)).toBe(true);
    expect(Object.isFrozen(result.role.toSnapshot())).toBe(true);
    expect(Object.isFrozen(result.role.toSnapshot().permissions)).toBe(true);
    expectFrozenSafeFacts(result.facts);
  });

  it('sorts initial permissions and emits auditable grants in canonical order', (): void => {
    const result = IdentityRole.create({
      id: ROLE_ID,
      code: ROLE_CODE,
      displayName: DISPLAY_NAME,
      permissions: [P_PRODUCT_WRITE, P_AUDIT_READ, P_PRODUCT_READ],
      occurredAt: T0,
    });

    expect(result.role.toSnapshot().permissions).toEqual([
      P_AUDIT_READ,
      P_PRODUCT_READ,
      P_PRODUCT_WRITE,
    ]);
    expect(result.facts).toEqual([
      {
        type: 'ROLE_CREATED',
        roleId: ROLE_ID,
        status: 'ACTIVE',
        version: 1,
        occurredAt: T0,
      },
      ...[P_AUDIT_READ, P_PRODUCT_READ, P_PRODUCT_WRITE].map((permissionCode) => ({
        type: 'ROLE_PERMISSION_GRANTED',
        roleId: ROLE_ID,
        permissionCode,
        status: 'ACTIVE',
        version: 1,
        occurredAt: T0,
      })),
    ]);
    expectFrozenSafeFacts(result.facts);
  });

  it('copies and freezes the caller-owned permission array', (): void => {
    const permissions = [P_PRODUCT_READ, P_PRODUCT_WRITE];
    const role = IdentityRole.create({
      id: ROLE_ID,
      code: ROLE_CODE,
      displayName: DISPLAY_NAME,
      permissions,
      occurredAt: T0,
    }).role;
    permissions.push(P_SKU_READ);

    expect(role.toSnapshot().permissions).toEqual([P_PRODUCT_READ, P_PRODUCT_WRITE]);
    expect(() => {
      (role.toSnapshot().permissions as unknown as string[]).push(P_SKU_READ);
    }).toThrow(TypeError);
    expect(role.toSnapshot().permissions).toEqual([P_PRODUCT_READ, P_PRODUCT_WRITE]);
    expect(Object.keys(role)).toEqual([]);
    expect(JSON.stringify(role)).toBe('{}');
  });

  it.each([
    [
      'missing id',
      {
        id: undefined,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: [],
        occurredAt: T0,
      },
      InvalidIdentityRoleIdError,
    ],
    [
      'invalid code',
      { id: ROLE_ID, code: 'Role', displayName: DISPLAY_NAME, permissions: [], occurredAt: T0 },
      InvalidIdentityRoleCodeError,
    ],
    [
      'invalid display name',
      { id: ROLE_ID, code: ROLE_CODE, displayName: ' Role ', permissions: [], occurredAt: T0 },
      InvalidIdentityRoleDisplayNameError,
    ],
    [
      'non-array permissions',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: null,
        occurredAt: T0,
      },
      InvalidIdentityRolePermissionSetError,
    ],
    [
      'sparse permissions',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: SPARSE_PERMISSION_SET,
        occurredAt: T0,
      },
      InvalidIdentityRolePermissionSetError,
    ],
    [
      'inherited permission index',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: inheritedPermissionSet(),
        occurredAt: T0,
      },
      InvalidIdentityRolePermissionSetError,
    ],
    [
      'permission array growing during parsing',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: growingPermissionSet(),
        occurredAt: T0,
      },
      InvalidIdentityRolePermissionSetError,
    ],
    [
      'invalid permission',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: ['catalog.*.read'],
        occurredAt: T0,
      },
      InvalidIdentityPermissionCodeError,
    ],
    [
      'duplicate permission',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: [P_PRODUCT_READ, P_PRODUCT_READ],
        occurredAt: T0,
      },
      InvalidIdentityRolePermissionSetError,
    ],
    [
      'permission capacity overflow',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: permissionSet(129),
        occurredAt: T0,
      },
      IdentityRolePermissionCapacityExceededError,
    ],
    [
      'invalid occurrence time',
      {
        id: ROLE_ID,
        code: ROLE_CODE,
        displayName: DISPLAY_NAME,
        permissions: [],
        occurredAt: 'not-an-instant',
      },
      InvalidIdentityInstantError,
    ],
  ] as const)(
    'rejects creation with %s before returning state or facts',
    (_scenario, input, expectedError): void => {
      let result: ReturnType<typeof IdentityRole.create> | null = null;

      expect(() => {
        result = IdentityRole.create(input satisfies CreateIdentityRoleInput);
      }).toThrow(expectedError);
      expect(result).toBeNull();
    },
  );

  it.each([
    ['initial empty Active Role', activeSnapshot()],
    [
      'initial populated Active Role',
      activeSnapshot({ permissions: [P_AUDIT_READ, P_PRODUCT_READ] }),
    ],
    [
      'later Active Role',
      activeSnapshot({
        displayName: RENAMED_DISPLAY_NAME,
        permissions: [P_AUDIT_READ, P_PRODUCT_READ, P_SKU_READ],
        version: 4,
        updatedAt: T1,
      }),
    ],
    [
      'Retired Role retaining mappings',
      retiredSnapshot({ permissions: [P_AUDIT_READ, P_PRODUCT_READ] }),
    ],
    ['Role changed at the creation instant', activeSnapshot({ version: 2 })],
  ])('rehydrates a valid %s without producing facts', (_scenario, snapshot): void => {
    const role = IdentityRole.rehydrate(snapshot);

    expect(role.toSnapshot()).toEqual(snapshot);
    expect(Object.isFrozen(role)).toBe(true);
    expect(Object.isFrozen(role.toSnapshot())).toBe(true);
    expect(Object.isFrozen(role.toSnapshot().permissions)).toBe(true);
    expect(Object.keys(role)).toEqual([]);
  });

  it('does not retain a mutable persistence permission array', (): void => {
    const permissions = [P_AUDIT_READ, P_PRODUCT_READ];
    const snapshot = { ...activeSnapshot({ permissions }), version: 2, updatedAt: T1 };
    const role = IdentityRole.rehydrate(snapshot);
    permissions.push(P_PRODUCT_WRITE);

    expect(role.toSnapshot().permissions).toEqual([P_AUDIT_READ, P_PRODUCT_READ]);
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing field', { id: ROLE_ID }],
    ['additional field', { ...activeSnapshot(), internal: 'value' }],
    ['invalid id', activeSnapshot({ id: 'persistence-role-id' })],
    ['invalid code', activeSnapshot({ code: 'Role' })],
    ['invalid display name', activeSnapshot({ displayName: ' Role ' })],
    ['invalid status', activeSnapshot({ status: 'SUSPENDED' })],
    ['invalid version', activeSnapshot({ version: 0 })],
    ['invalid creation time', activeSnapshot({ createdAt: 'not-an-instant' })],
    ['update before creation', activeSnapshot({ updatedAt: BEFORE_T0 })],
    ['version 1 with later update', activeSnapshot({ updatedAt: T1 })],
    ['Active Role with retirement time', activeSnapshot({ retiredAt: T0 })],
    ['Retired Role at version 1', retiredSnapshot({ version: 1 })],
    ['Retired Role without retirement time', retiredSnapshot({ retiredAt: null })],
    ['Retired Role with stale retirement time', retiredSnapshot({ retiredAt: T0 })],
    ['non-array permission set', activeSnapshot({ permissions: null })],
    ['sparse permission set', activeSnapshot({ permissions: SPARSE_PERMISSION_SET })],
    ['inherited permission index', activeSnapshot({ permissions: inheritedPermissionSet() })],
    [
      'permission array growing during parsing',
      activeSnapshot({ permissions: growingPermissionSet() }),
    ],
    ['invalid permission', activeSnapshot({ permissions: ['catalog.*.read'] })],
    ['duplicate permissions', activeSnapshot({ permissions: [P_PRODUCT_READ, P_PRODUCT_READ] })],
    [
      'noncanonical permission order',
      activeSnapshot({ permissions: [P_PRODUCT_READ, P_AUDIT_READ] }),
    ],
    ['permission capacity overflow', activeSnapshot({ permissions: permissionSet(129) })],
  ])('rejects corrupt %s with one fixed cause-free error', (_scenario, snapshot): void => {
    const error = captureError(() => IdentityRole.rehydrate(snapshot));

    expect(error).toBeInstanceOf(InvalidIdentityRoleStateError);
    expect(error).toMatchObject({
      message: 'Expected a valid Identity Role snapshot',
      name: 'InvalidIdentityRoleStateError',
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(error)).not.toContain('persistence-role-id');
    expect(String(error)).not.toContain('catalog.*.read');
    expect(JSON.stringify(error)).not.toContain('persistence-role-id');
  });
});

describe('IdentityRole effective mutations', (): void => {
  it('renames an Active Role without changing its authorization code or mappings', (): void => {
    const role = createRole([P_PRODUCT_READ]);
    const before = role.toSnapshot();
    const result = role.rename({
      displayName: RENAMED_DISPLAY_NAME,
      expectedVersion: 1,
      occurredAt: T1,
    });

    expect(result.kind).toBe('changed');
    expect(result.role.toSnapshot()).toEqual(
      activeSnapshot({
        displayName: RENAMED_DISPLAY_NAME,
        permissions: [P_PRODUCT_READ],
        version: 2,
        updatedAt: T1,
      }),
    );
    expect(result.facts).toEqual([
      {
        type: 'ROLE_RENAMED',
        roleId: ROLE_ID,
        status: 'ACTIVE',
        version: 2,
        occurredAt: T1,
      },
    ]);
    expectFrozenSafeFacts(result.facts);
    expect(role.toSnapshot()).toBe(before);
  });

  it.each([
    [
      'beginning',
      [P_PRODUCT_READ, P_SKU_READ],
      P_AUDIT_READ,
      [P_AUDIT_READ, P_PRODUCT_READ, P_SKU_READ],
    ],
    [
      'middle',
      [P_PRODUCT_READ, P_SKU_READ],
      P_PRODUCT_WRITE,
      [P_PRODUCT_READ, P_PRODUCT_WRITE, P_SKU_READ],
    ],
    ['end', [P_PRODUCT_READ, P_SKU_READ], P_ORDER_READ, [P_PRODUCT_READ, P_SKU_READ, P_ORDER_READ]],
  ] as const)(
    'grants a permission at the sorted %s',
    (_position, existing, permissionCode, expectedPermissions): void => {
      const role = createRole(existing);
      const result = role.grantPermission({ permissionCode, expectedVersion: 1, occurredAt: T1 });

      expect(result.kind).toBe('changed');
      expect(result.role.toSnapshot()).toMatchObject({
        permissions: expectedPermissions,
        version: 2,
        updatedAt: T1,
      });
      expect(result.facts).toEqual([
        {
          type: 'ROLE_PERMISSION_GRANTED',
          roleId: ROLE_ID,
          permissionCode,
          status: 'ACTIVE',
          version: 2,
          occurredAt: T1,
        },
      ]);
      expectFrozenSafeFacts(result.facts);
    },
  );

  it('allows the 128th mapping and rejects a 129th', (): void => {
    const first127 = permissionSet(127);
    const role = createRole(first127);
    const permission128 = permissionCodeAt(127);
    const full = role.grantPermission({
      permissionCode: permission128,
      expectedVersion: 1,
      occurredAt: T1,
    });

    expect(full.kind).toBe('changed');
    expect(full.role.toSnapshot().permissions).toHaveLength(MAX_IDENTITY_ROLE_PERMISSIONS);
    expectSafeImmutableRejection(
      full.role,
      () =>
        full.role.grantPermission({
          permissionCode: permissionCodeAt(128),
          expectedVersion: 2,
          occurredAt: T2,
        }),
      IdentityRolePermissionCapacityExceededError,
    );
  });

  it.each([
    [
      'beginning',
      [P_AUDIT_READ, P_PRODUCT_READ, P_SKU_READ],
      P_AUDIT_READ,
      [P_PRODUCT_READ, P_SKU_READ],
    ],
    [
      'middle',
      [P_AUDIT_READ, P_PRODUCT_READ, P_SKU_READ],
      P_PRODUCT_READ,
      [P_AUDIT_READ, P_SKU_READ],
    ],
    ['end', [P_AUDIT_READ, P_PRODUCT_READ, P_SKU_READ], P_SKU_READ, [P_AUDIT_READ, P_PRODUCT_READ]],
    ['last remaining', [P_PRODUCT_READ], P_PRODUCT_READ, []],
  ] as const)(
    'revokes the %s permission',
    (_position, existing, permissionCode, expectedPermissions): void => {
      const role = createRole(existing);
      const result = role.revokePermission({ permissionCode, expectedVersion: 1, occurredAt: T1 });

      expect(result.kind).toBe('changed');
      expect(result.role.toSnapshot()).toMatchObject({
        permissions: expectedPermissions,
        version: 2,
        updatedAt: T1,
      });
      expect(result.facts).toEqual([
        {
          type: 'ROLE_PERMISSION_REVOKED',
          roleId: ROLE_ID,
          permissionCode,
          status: 'ACTIVE',
          version: 2,
          occurredAt: T1,
        },
      ]);
      expectFrozenSafeFacts(result.facts);
    },
  );

  it('retires an Active Role while preserving its mappings', (): void => {
    const role = createRole([P_PRODUCT_READ, P_PRODUCT_WRITE]);
    const result = role.retire({ expectedVersion: 1, occurredAt: T1 });

    expect(result.role.toSnapshot()).toEqual(
      retiredSnapshot({ permissions: [P_PRODUCT_READ, P_PRODUCT_WRITE] }),
    );
    expect(result.facts).toEqual([
      {
        type: 'ROLE_RETIRED',
        roleId: ROLE_ID,
        previousStatus: 'ACTIVE',
        status: 'RETIRED',
        version: 2,
        occurredAt: T1,
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.role)).toBe(true);
    expectFrozenSafeFacts(result.facts);
  });

  it('accepts an equal authoritative mutation instant because version orders changes', (): void => {
    const renamed = createRole().rename({
      displayName: RENAMED_DISPLAY_NAME,
      expectedVersion: 1,
      occurredAt: T0,
    });

    expect(renamed.role.toSnapshot()).toMatchObject({ version: 2, updatedAt: T0 });
  });
});

describe('IdentityRole no-ops and stable failure precedence', (): void => {
  it.each([
    [
      'same display name',
      (role: IdentityRole): unknown =>
        role.rename({
          displayName: DISPLAY_NAME,
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          occurredAt: 'not-an-instant',
        }),
    ],
    [
      'existing permission grant',
      (role: IdentityRole): unknown =>
        role.grantPermission({
          permissionCode: P_PRODUCT_READ,
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          occurredAt: 'not-an-instant',
        }),
    ],
    [
      'absent permission revocation',
      (role: IdentityRole): unknown =>
        role.revokePermission({
          permissionCode: P_PRODUCT_WRITE,
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          occurredAt: 'not-an-instant',
        }),
    ],
  ] as const)('returns the original Role for a semantic %s', (_scenario, invoke): void => {
    const role = IdentityRole.rehydrate(
      activeSnapshot({
        permissions: [P_PRODUCT_READ],
        version: MAX_IDENTITY_AGGREGATE_VERSION,
        updatedAt: T1,
      }),
    );
    const result = invoke(role) as ReturnType<IdentityRole['rename']>;

    expect(result).toEqual({ kind: 'unchanged', role, facts: [] });
    expect(result.role).toBe(role);
    expect(Object.isFrozen(result)).toBe(true);
    expectFrozenSafeFacts(result.facts);
  });

  it('rejects a stale lost-response replay before recognizing a present mapping', (): void => {
    const changed = createRole().grantPermission({
      permissionCode: P_PRODUCT_READ,
      expectedVersion: 1,
      occurredAt: T1,
    });

    expectSafeImmutableRejection(
      changed.role,
      () =>
        changed.role.grantPermission({
          permissionCode: P_PRODUCT_READ,
          expectedVersion: 1,
          occurredAt: T2,
        }),
      IdentityRoleVersionMismatchError,
    );
  });

  it('checks version, lifecycle, candidate, no-op, time, mapping capacity, then version capacity', (): void => {
    const retired = IdentityRole.rehydrate(retiredSnapshot({ permissions: [P_PRODUCT_READ] }));
    const active = createRole([P_PRODUCT_READ]);
    const full = IdentityRole.rehydrate(
      activeSnapshot({
        permissions: permissionSet(128),
        version: MAX_IDENTITY_AGGREGATE_VERSION,
        updatedAt: T1,
      }),
    );

    expectSafeImmutableRejection(
      retired,
      () =>
        retired.grantPermission({
          permissionCode: 'invalid',
          expectedVersion: 1,
          occurredAt: 'not-an-instant',
        }),
      IdentityRoleVersionMismatchError,
    );
    expectSafeImmutableRejection(
      retired,
      () =>
        retired.grantPermission({
          permissionCode: 'invalid',
          expectedVersion: 2,
          occurredAt: 'not-an-instant',
        }),
      IdentityRoleLifecycleConflictError,
    );
    expectSafeImmutableRejection(
      active,
      () =>
        active.grantPermission({
          permissionCode: 'invalid',
          expectedVersion: 1,
          occurredAt: 'not-an-instant',
        }),
      InvalidIdentityPermissionCodeError,
    );
    expectSafeImmutableRejection(
      active,
      () =>
        active.grantPermission({
          permissionCode: P_PRODUCT_WRITE,
          expectedVersion: 1,
          occurredAt: BEFORE_T0,
        }),
      IdentityRoleTimestampRegressionError,
    );
    expectSafeImmutableRejection(
      full,
      () =>
        full.grantPermission({
          permissionCode: P_ORDER_READ,
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          occurredAt: T2,
        }),
      IdentityRolePermissionCapacityExceededError,
    );
  });

  it.each([
    [
      'rename',
      (role: IdentityRole): unknown =>
        role.rename({
          displayName: RENAMED_DISPLAY_NAME,
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          occurredAt: T2,
        }),
    ],
    [
      'grant',
      (role: IdentityRole): unknown =>
        role.grantPermission({
          permissionCode: P_PRODUCT_WRITE,
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          occurredAt: T2,
        }),
    ],
    [
      'revoke',
      (role: IdentityRole): unknown =>
        role.revokePermission({
          permissionCode: P_PRODUCT_READ,
          expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION,
          occurredAt: T2,
        }),
    ],
    [
      'retire',
      (role: IdentityRole): unknown =>
        role.retire({ expectedVersion: MAX_IDENTITY_AGGREGATE_VERSION, occurredAt: T2 }),
    ],
  ] as const)(
    'rejects aggregate-version exhaustion for an actual %s',
    (_scenario, invoke): void => {
      const role = IdentityRole.rehydrate(
        activeSnapshot({
          permissions: [P_PRODUCT_READ],
          version: MAX_IDENTITY_AGGREGATE_VERSION,
          updatedAt: T1,
        }),
      );

      expectSafeImmutableRejection(
        role,
        () => invoke(role),
        IdentityAggregateVersionExhaustedError,
      );
    },
  );

  it('checks retirement version, lifecycle, time, then aggregate capacity', (): void => {
    const retired = IdentityRole.rehydrate(retiredSnapshot());
    const active = createRole();

    expectSafeImmutableRejection(
      retired,
      () => retired.retire({ expectedVersion: 1, occurredAt: 'not-an-instant' }),
      IdentityRoleVersionMismatchError,
    );
    expectSafeImmutableRejection(
      retired,
      () => retired.retire({ expectedVersion: 2, occurredAt: 'not-an-instant' }),
      IdentityRoleLifecycleConflictError,
    );
    expectSafeImmutableRejection(
      active,
      () => active.retire({ expectedVersion: 1, occurredAt: BEFORE_T0 }),
      IdentityRoleTimestampRegressionError,
    );
  });

  it('rejects every mutation of a Retired Role', (): void => {
    const role = IdentityRole.rehydrate(retiredSnapshot({ permissions: [P_PRODUCT_READ] }));
    const operations = [
      () => role.rename({ displayName: RENAMED_DISPLAY_NAME, expectedVersion: 2, occurredAt: T2 }),
      () =>
        role.grantPermission({
          permissionCode: P_PRODUCT_WRITE,
          expectedVersion: 2,
          occurredAt: T2,
        }),
      () =>
        role.revokePermission({
          permissionCode: P_PRODUCT_READ,
          expectedVersion: 2,
          occurredAt: T2,
        }),
      () => role.retire({ expectedVersion: 2, occurredAt: T2 }),
    ];

    for (const operation of operations) {
      expectSafeImmutableRejection(role, operation, IdentityRoleLifecycleConflictError);
    }
  });

  it('distinguishes an invalid version category from a stale supported version', (): void => {
    const role = createRole();

    expectSafeImmutableRejection(
      role,
      () => role.rename({ displayName: RENAMED_DISPLAY_NAME, expectedVersion: 0, occurredAt: T1 }),
      InvalidIdentityAggregateVersionError,
    );
    expectSafeImmutableRejection(
      role,
      () => role.rename({ displayName: RENAMED_DISPLAY_NAME, expectedVersion: 2, occurredAt: T1 }),
      IdentityRoleVersionMismatchError,
    );
  });
});

const _snapshotTypeCheck: IdentityRoleSnapshot = createRole().toSnapshot();
void _snapshotTypeCheck;
