import { isProxy } from 'node:util/types';

import * as identityPublicApi from '../../src';
import {
  decodeIdentitySessionRefreshConditionalMySqlWriteResult,
  decodeIdentitySessionRefreshInsertMySqlWriteResult,
} from '../../src/infrastructure/mysql/identity-session-refresh-mysql-write-result';
import {
  decodeIdentitySessionRefreshReuseDetectedFamilyMySqlWriteResult,
  decodeIdentitySessionRefreshReuseDetectedSecurityEventMySqlWriteResult,
  IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS,
  IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
} from '../../src/infrastructure/mysql/identity-session-refresh-reuse-detected.statements';

class OkPacket {
  public constructor(
    public affectedRows: number,
    public insertId: bigint,
    public warningStatus: number,
  ) {}
}

type Decoder = (this: undefined, value: unknown) => Readonly<{ kind: string }>;

function packet(affectedRows: number): OkPacket {
  return new OkPacket(affectedRows, 0n, 0);
}

function packetWithout(property: 'affectedRows' | 'insertId' | 'warningStatus'): object {
  const value = packet(1);

  Reflect.deleteProperty(value, property);
  return value;
}

function decodeFamily(value: unknown): Readonly<{ kind: string }> {
  return decodeIdentitySessionRefreshReuseDetectedFamilyMySqlWriteResult.call(undefined, value);
}

function decodeEvent(value: unknown): Readonly<{ kind: string }> {
  return decodeIdentitySessionRefreshReuseDetectedSecurityEventMySqlWriteResult.call(
    undefined,
    value,
  );
}

function descriptorMutation(
  property: 'affectedRows' | 'insertId' | 'warningStatus',
  descriptor: PropertyDescriptor,
): OkPacket {
  const value = packet(1);
  Object.defineProperty(value, property, descriptor);
  return value;
}

describe('Identity refresh reuse-detected MySQL statements', (): void => {
  it('decodes exact custom-prototype update and insert packets into frozen evidence', (): void => {
    const changedFamily = decodeFamily(packet(1));
    const unchangedFamily = decodeFamily(packet(0));
    const changedEvent = decodeEvent(packet(1));

    expect(changedFamily).toEqual({ kind: 'changed' });
    expect(unchangedFamily).toEqual({ kind: 'no-match' });
    expect(changedEvent).toEqual({ kind: 'changed' });
    expect(Object.isFrozen(changedFamily)).toBe(true);
    expect(Object.isFrozen(unchangedFamily)).toBe(true);
    expect(Object.isFrozen(changedEvent)).toBe(true);
    expect(Reflect.ownKeys(changedFamily)).toEqual(['kind']);
    expect(decodeEvent(packet(0))).toEqual({ kind: 'malformed' });
  });

  it('delegates without consulting mutable Function.prototype.call authority', (): void => {
    const conditionalCallDescriptor = Object.getOwnPropertyDescriptor(
      decodeIdentitySessionRefreshConditionalMySqlWriteResult,
      'call',
    );
    const insertCallDescriptor = Object.getOwnPropertyDescriptor(
      decodeIdentitySessionRefreshInsertMySqlWriteResult,
      'call',
    );
    const failIfCalled = (): never => {
      throw new Error('mutable call authority reached');
    };

    Object.defineProperty(decodeIdentitySessionRefreshConditionalMySqlWriteResult, 'call', {
      configurable: true,
      value: failIfCalled,
    });
    Object.defineProperty(decodeIdentitySessionRefreshInsertMySqlWriteResult, 'call', {
      configurable: true,
      value: failIfCalled,
    });

    try {
      expect(decodeFamily(packet(1))).toEqual({ kind: 'changed' });
      expect(decodeEvent(packet(1))).toEqual({ kind: 'changed' });
    } finally {
      if (conditionalCallDescriptor === undefined) {
        Reflect.deleteProperty(decodeIdentitySessionRefreshConditionalMySqlWriteResult, 'call');
      } else {
        Object.defineProperty(
          decodeIdentitySessionRefreshConditionalMySqlWriteResult,
          'call',
          conditionalCallDescriptor,
        );
      }

      if (insertCallDescriptor === undefined) {
        Reflect.deleteProperty(decodeIdentitySessionRefreshInsertMySqlWriteResult, 'call');
      } else {
        Object.defineProperty(
          decodeIdentitySessionRefreshInsertMySqlWriteResult,
          'call',
          insertCallDescriptor,
        );
      }
    }
  });

  it.each([
    ['plain record', { affectedRows: 1, insertId: 0n, warningStatus: 0 }],
    ['null-prototype record', Object.assign(Object.create(null), packet(1))],
    ['array', Object.assign([], packet(1))],
    ['proxy', new Proxy(packet(1), {})],
    ['missing field', packetWithout('warningStatus')],
    ['extra field', Object.assign(packet(1), { extra: 1 })],
    ['symbol field', Object.assign(packet(1), { [Symbol('extra')]: 1 })],
    ['affected rows bigint', Object.assign(packet(1), { affectedRows: 1n })],
    ['affected rows string', Object.assign(packet(1), { affectedRows: '1' })],
    ['negative affected rows', packet(-1)],
    ['overflow affected rows', packet(2)],
    ['numeric insert id', new OkPacket(1, 0 as unknown as bigint, 0)],
    ['nonzero insert id', new OkPacket(1, 1n, 0)],
    ['bigint warning', new OkPacket(1, 0n, 0n as unknown as number)],
    ['warning', new OkPacket(1, 0n, 1)],
  ] as const)('returns malformed for a %s', (_scenario, value): void => {
    expect(decodeFamily(value)).toEqual({ kind: 'malformed' });
    expect(decodeEvent(value)).toEqual({ kind: 'malformed' });
  });

  it.each([
    ['accessor', 'affectedRows', { configurable: true, enumerable: true, get: (): number => 1 }],
    [
      'non-enumerable',
      'insertId',
      { configurable: true, enumerable: false, value: 0n, writable: true },
    ],
    [
      'read-only',
      'warningStatus',
      { configurable: true, enumerable: true, value: 0, writable: false },
    ],
    [
      'non-configurable',
      'affectedRows',
      { configurable: false, enumerable: true, value: 1, writable: true },
    ],
  ] as const)(
    'returns malformed for an own %s descriptor',
    (_scenario, property, descriptor): void => {
      const value = descriptorMutation(property, descriptor);

      expect(decodeFamily(value)).toEqual({ kind: 'malformed' });
      expect(decodeEvent(value)).toEqual({ kind: 'malformed' });
    },
  );

  it('rejects a malformed or proxied custom prototype without triggering traps', (): void => {
    const foreignPrototype = Object.create(Object.prototype) as object;
    Object.defineProperty(foreignPrototype, 'constructor', {
      configurable: false,
      enumerable: false,
      value: function ForeignPacket(): undefined {
        return undefined;
      },
      writable: true,
    });
    const foreignPacket: object = Object.assign(
      Object.create(foreignPrototype) as object,
      packet(1),
    );
    let trapCalls = 0;
    const proxyPrototype = new Proxy(Object.getPrototypeOf(packet(1)) as object, {
      get(): never {
        trapCalls += 1;
        throw new Error('prototype trap');
      },
    });
    const proxyPrototypePacket: object = Object.assign(
      Object.create(proxyPrototype) as object,
      packet(1),
    );

    expect(decodeFamily(foreignPacket)).toEqual({ kind: 'malformed' });
    expect(decodeFamily(proxyPrototypePacket)).toEqual({ kind: 'malformed' });
    expect(trapCalls).toBe(0);
  });

  it.each([
    ['family', decodeIdentitySessionRefreshReuseDetectedFamilyMySqlWriteResult],
    ['event', decodeIdentitySessionRefreshReuseDetectedSecurityEventMySqlWriteResult],
  ] as const)('keeps the %s decoder total for hostile inputs', (_kind, decoder: Decoder): void => {
    let trapCalls = 0;
    const hostile = new Proxy(
      {},
      {
        get(): never {
          trapCalls += 1;
          throw new Error('secret getter');
        },
      },
    );

    expect(decoder.call(undefined, hostile)).toEqual({ kind: 'malformed' });
    expect(trapCalls).toBe(0);
  });

  it('publishes only opaque frozen statement identities in fixed update-then-event order', (): void => {
    expect(IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS).toEqual([
      IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
    ]);
    expect(Object.isFrozen(IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS)).toBe(true);

    for (const statement of IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS) {
      expect(Object.isFrozen(statement)).toBe(true);
      expect(Reflect.ownKeys(statement)).toEqual([]);
      expect(statement).not.toHaveProperty('text');
      expect(statement).not.toHaveProperty('decode');
      expect(isProxy(statement)).toBe(false);
    }
  });

  it('does not add the private statement slice to the supported Identity root', (): void => {
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS',
    );
  });
});
