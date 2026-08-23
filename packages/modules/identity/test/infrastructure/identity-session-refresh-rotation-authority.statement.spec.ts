import { isProxy } from 'node:util/types';

import type { MySqlTransactionStatementParameters } from '@oms/database/mysql-transaction';

import * as identityPublicApi from '../../src';
import { mapIdentityAuthorityProjectionRows } from '../../src/infrastructure/identity-authority-projection.mapper';
import {
  decodeIdentitySessionRefreshRotationAuthorityMySqlRows,
  IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
  type IdentitySessionRefreshRotationAuthorityMySqlResult,
} from '../../src/infrastructure/mysql/identity-session-refresh-rotation-authority.statement';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const ROLE_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const OTHER_ROLE_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const RETIRED_ROLE_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';

type UnknownRow = Readonly<Record<string, unknown>>;
type RotationAuthorityParameters = MySqlTransactionStatementParameters<
  typeof IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT
>;

function authorityRow(overrides: Readonly<Record<string, unknown>> = {}): UnknownRow {
  return {
    authority_state: 'RESOLVED',
    actor_id: ACCOUNT_ID,
    session_id: SESSION_ID,
    assigned_role_id: ROLE_ID,
    loaded_role_id: ROLE_ID,
    role_status: 'ACTIVE',
    mapped_permission_code: 'orders.records.read',
    permission_code: 'orders.records.read',
    ...overrides,
  };
}

function rejectedRow(): UnknownRow {
  return {
    authority_state: 'REJECTED',
    actor_id: null,
    session_id: null,
    assigned_role_id: null,
    loaded_role_id: null,
    role_status: null,
    mapped_permission_code: null,
    permission_code: null,
  };
}

function withMariaDbMeta<Row>(
  rows: Row[],
  descriptor: PropertyDescriptor = {
    configurable: false,
    enumerable: false,
    value: Object.freeze([]),
    writable: true,
  },
): Row[] {
  Object.defineProperty(rows, 'meta', descriptor);
  return rows;
}

function decode(value: unknown): IdentitySessionRefreshRotationAuthorityMySqlResult {
  return decodeIdentitySessionRefreshRotationAuthorityMySqlRows.call(undefined, value);
}

function rowDescriptorMutation(key: string, descriptor: PropertyDescriptor): UnknownRow {
  const row = authorityRow() as Record<string, unknown>;
  Object.defineProperty(row, key, descriptor);
  return row;
}

function envelopeIndexDescriptorMutation(descriptor: PropertyDescriptor): UnknownRow[] {
  const rows = withMariaDbMeta([authorityRow()]);
  Object.defineProperty(rows, '0', descriptor);
  return rows;
}

describe('Identity refresh rotation authority MySQL statement', (): void => {
  it('normalizes an exact MariaDB envelope and maps bounded current authority', (): void => {
    const result = decode(
      withMariaDbMeta([
        authorityRow({
          mapped_permission_code: 'orders.records.write',
          permission_code: 'orders.records.write',
        }),
        authorityRow(),
        authorityRow({
          assigned_role_id: OTHER_ROLE_ID,
          loaded_role_id: OTHER_ROLE_ID,
        }),
        authorityRow({
          assigned_role_id: RETIRED_ROLE_ID,
          loaded_role_id: RETIRED_ROLE_ID,
          mapped_permission_code: null,
          permission_code: null,
          role_status: 'RETIRED',
        }),
      ]),
    );

    expect(result).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 2,
        permissions: ['orders.records.read', 'orders.records.write'],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);

    if (result.kind !== 'resolved') throw new Error('Expected resolved authority');
    expect(Object.isFrozen(result.projection)).toBe(true);
    expect(Object.isFrozen(result.projection.permissions)).toBe(true);
    expect(Reflect.ownKeys(result)).toEqual(['kind', 'projection']);
  });

  it('resolves an Account with no assigned roles to an empty authority set', (): void => {
    const result = decode(
      withMariaDbMeta([
        authorityRow({
          assigned_role_id: null,
          loaded_role_id: null,
          mapped_permission_code: null,
          permission_code: null,
          role_status: null,
        }),
      ]),
    );

    expect(result).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 0,
        permissions: [],
      },
    });
  });

  it('uses its captured mapper invocation when Function call is polluted after import', (): void => {
    const callDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, 'call');

    if (callDescriptor === undefined || typeof callDescriptor.value !== 'function') {
      throw new Error('Expected Function call intrinsic');
    }

    const originalCall = callDescriptor.value as (...arguments_: unknown[]) => unknown;
    let poisonedMapperCalls = 0;
    let result: IdentitySessionRefreshRotationAuthorityMySqlResult | undefined;

    Object.defineProperty(Function.prototype, 'call', {
      ...callDescriptor,
      value(this: unknown, ...arguments_: unknown[]): unknown {
        if (this === mapIdentityAuthorityProjectionRows) {
          poisonedMapperCalls += 1;
          throw new Error('polluted mapper Function.call');
        }

        return Reflect.apply(originalCall, this, arguments_);
      },
    });

    try {
      result = decode(withMariaDbMeta([authorityRow()]));
    } finally {
      Object.defineProperty(Function.prototype, 'call', callDescriptor);
    }

    expect(result).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 1,
        permissions: ['orders.records.read'],
      },
    });
    expect(poisonedMapperCalls).toBe(0);
  });

  it('does not resolve the mutable global String binding while normalizing rows', (): void => {
    const stringDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'String');

    if (stringDescriptor === undefined || typeof stringDescriptor.value !== 'function') {
      throw new Error('Expected global String constructor');
    }

    const envelope = withMariaDbMeta([
      authorityRow(),
      authorityRow({
        assigned_role_id: OTHER_ROLE_ID,
        loaded_role_id: OTHER_ROLE_ID,
        mapped_permission_code: 'orders.records.write',
        permission_code: 'orders.records.write',
      }),
    ]);
    let stringCalls = 0;
    let result: IdentitySessionRefreshRotationAuthorityMySqlResult | undefined;
    let failure: unknown;

    Object.defineProperty(globalThis, 'String', {
      ...stringDescriptor,
      value(): string {
        stringCalls += 1;
        return '0';
      },
    });

    try {
      result = decode(envelope);
    } catch (error: unknown) {
      failure = error;
    } finally {
      Object.defineProperty(globalThis, 'String', stringDescriptor);
    }

    expect(failure).toBeUndefined();
    expect(result).toEqual({
      kind: 'resolved',
      projection: {
        actorId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 2,
        permissions: ['orders.records.read', 'orders.records.write'],
      },
    });
    expect(stringCalls).toBe(0);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'String')).toEqual(stringDescriptor);
  });

  it.each([
    ['empty projection', withMariaDbMeta([])],
    ['rejected projection', withMariaDbMeta([rejectedRow()])],
    ['corrupt projection', withMariaDbMeta([authorityRow({ authority_state: 'CORRUPT' })])],
    ['unknown state', withMariaDbMeta([authorityRow({ authority_state: 'UNKNOWN' })])],
    [
      'cross-Account row',
      withMariaDbMeta([authorityRow(), authorityRow({ actor_id: OTHER_ACCOUNT_ID })]),
    ],
    ['missing role row', withMariaDbMeta([authorityRow({ loaded_role_id: null })])],
    ['duplicate role-permission row', withMariaDbMeta([authorityRow(), authorityRow()])],
    [
      'overflow probe',
      withMariaDbMeta(Array.from({ length: 2_049 }, (): UnknownRow => authorityRow())),
    ],
  ] as const)('returns malformed for a semantically invalid %s', (_scenario, value): void => {
    const result = decode(value);

    expect(result).toEqual({ kind: 'malformed' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.ownKeys(result)).toEqual(['kind']);
  });

  it.each([
    ['plain array without metadata', [authorityRow()]],
    [
      'enumerable metadata',
      withMariaDbMeta([authorityRow()], {
        configurable: false,
        enumerable: true,
        value: [],
        writable: true,
      }),
    ],
    [
      'configurable metadata',
      withMariaDbMeta([authorityRow()], {
        configurable: true,
        enumerable: false,
        value: [],
        writable: true,
      }),
    ],
    [
      'read-only metadata',
      withMariaDbMeta([authorityRow()], {
        configurable: false,
        enumerable: false,
        value: [],
        writable: false,
      }),
    ],
    ['extra envelope field', Object.assign(withMariaDbMeta([authorityRow()]), { extra: true })],
    [
      'symbol envelope field',
      Object.assign(withMariaDbMeta([authorityRow()]), { [Symbol('extra')]: true }),
    ],
    ['sparse envelope', withMariaDbMeta(new Array<UnknownRow>(1))],
    [
      'accessor row index',
      envelopeIndexDescriptorMutation({
        configurable: true,
        enumerable: true,
        get: (): UnknownRow => authorityRow(),
      }),
    ],
    [
      'read-only row index',
      envelopeIndexDescriptorMutation({
        configurable: true,
        enumerable: true,
        value: authorityRow(),
        writable: false,
      }),
    ],
    [
      'non-enumerable row index',
      envelopeIndexDescriptorMutation({
        configurable: true,
        enumerable: false,
        value: authorityRow(),
        writable: true,
      }),
    ],
    [
      'non-configurable row index',
      envelopeIndexDescriptorMutation({
        configurable: false,
        enumerable: true,
        value: authorityRow(),
        writable: true,
      }),
    ],
    [
      'overflow envelope',
      withMariaDbMeta(Array.from({ length: 2_050 }, (): UnknownRow => authorityRow())),
    ],
    ['non-array envelope', { 0: authorityRow(), length: 1, meta: [] }],
    ['array proxy', new Proxy(withMariaDbMeta([authorityRow()]), {})],
  ] as const)('returns malformed for an inauthentic %s', (_scenario, value): void => {
    expect(decode(value)).toEqual({ kind: 'malformed' });
  });

  it.each([
    ['array row', withMariaDbMeta([[authorityRow()]])],
    ['null-prototype row', withMariaDbMeta([Object.assign(Object.create(null), authorityRow())])],
    ['row proxy', withMariaDbMeta([new Proxy(authorityRow(), {})])],
    [
      'missing row field',
      withMariaDbMeta([
        Object.fromEntries(
          Object.entries(authorityRow()).filter(([key]): boolean => key !== 'permission_code'),
        ),
      ]),
    ],
    ['extra row field', withMariaDbMeta([{ ...authorityRow(), extra: true }])],
    ['symbol row field', withMariaDbMeta([{ ...authorityRow(), [Symbol('extra')]: true }])],
    [
      'accessor row field',
      withMariaDbMeta([
        rowDescriptorMutation('actor_id', {
          configurable: true,
          enumerable: true,
          get: (): string => ACCOUNT_ID,
        }),
      ]),
    ],
    [
      'non-enumerable row field',
      withMariaDbMeta([
        rowDescriptorMutation('actor_id', {
          configurable: true,
          enumerable: false,
          value: ACCOUNT_ID,
          writable: true,
        }),
      ]),
    ],
    [
      'read-only row field',
      withMariaDbMeta([
        rowDescriptorMutation('actor_id', {
          configurable: true,
          enumerable: true,
          value: ACCOUNT_ID,
          writable: false,
        }),
      ]),
    ],
    [
      'non-configurable row field',
      withMariaDbMeta([
        rowDescriptorMutation('actor_id', {
          configurable: false,
          enumerable: true,
          value: ACCOUNT_ID,
          writable: true,
        }),
      ]),
    ],
  ] as const)('returns malformed for an unsafe %s', (_scenario, value): void => {
    expect(decode(value)).toEqual({ kind: 'malformed' });
  });

  it('does not invoke hostile envelope or row accessors', (): void => {
    let trapCalls = 0;
    const envelopeProxy = new Proxy(
      {},
      {
        get(): never {
          trapCalls += 1;
          throw new Error('envelope secret');
        },
      },
    );
    const row = rowDescriptorMutation('actor_id', {
      configurable: true,
      enumerable: true,
      get(): never {
        trapCalls += 1;
        throw new Error('row secret');
      },
    });

    expect(decode(envelopeProxy)).toEqual({ kind: 'malformed' });
    expect(decode(withMariaDbMeta([row]))).toEqual({ kind: 'malformed' });
    expect(trapCalls).toBe(0);
  });

  it.each([undefined, null, true, 1, 1n, 'rows', Symbol('rows'), (): void => undefined])(
    'keeps the decoder total for hostile primitive %p',
    (value): void => {
      expect(decode(value)).toEqual({ kind: 'malformed' });
    },
  );

  it('publishes one opaque frozen statement with the exact parameter contract', (): void => {
    const parameters: RotationAuthorityParameters = [ACCOUNT_ID, 7, SESSION_ID, 8];

    expect(parameters).toEqual([ACCOUNT_ID, 7, SESSION_ID, 8]);
    expect(Object.isFrozen(IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT)).toBe(true);
    expect(Reflect.ownKeys(IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT)).toEqual(
      [],
    );
    expect(IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT).not.toHaveProperty('text');
    expect(IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT).not.toHaveProperty(
      'decode',
    );
    expect(isProxy(IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT)).toBe(false);
  });

  it('does not add the private authority statement slice to the supported Identity root', (): void => {
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'decodeIdentitySessionRefreshRotationAuthorityMySqlRows',
    );
  });
});
