import { isProxy } from 'node:util/types';

import * as identityPublicApi from '../../src';
import {
  decodeIdentitySessionRefreshConditionalMySqlWriteResult,
  decodeIdentitySessionRefreshInsertMySqlWriteResult,
} from '../../src/infrastructure/mysql/identity-session-refresh-mysql-write-result';
import {
  IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS,
} from '../../src/infrastructure/mysql/identity-session-refresh-rotation.statements';
import { IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT } from '../../src/infrastructure/mysql/identity-session-refresh-rotation-authority.statement';

class OkPacket {
  public constructor(
    public affectedRows: number,
    public insertId: bigint,
    public warningStatus: number,
  ) {}
}

function packet(affectedRows: number): OkPacket {
  return new OkPacket(affectedRows, 0n, 0);
}

function decodeConditional(value: unknown): Readonly<{ kind: string }> {
  return decodeIdentitySessionRefreshConditionalMySqlWriteResult.call(undefined, value);
}

function decodeInsert(value: unknown): Readonly<{ kind: string }> {
  return decodeIdentitySessionRefreshInsertMySqlWriteResult.call(undefined, value);
}

describe('Identity refresh rotation MySQL statements', (): void => {
  it('decodes exact conditional and insert outcomes into frozen evidence', (): void => {
    const changedConditional = decodeConditional(packet(1));
    const noMatch = decodeConditional(packet(0));
    const changedInsert = decodeInsert(packet(1));

    expect(changedConditional).toEqual({ kind: 'changed' });
    expect(noMatch).toEqual({ kind: 'no-match' });
    expect(changedInsert).toEqual({ kind: 'changed' });
    expect(decodeInsert(packet(0))).toEqual({ kind: 'malformed' });
    expect(Object.isFrozen(changedConditional)).toBe(true);
    expect(Object.isFrozen(noMatch)).toBe(true);
    expect(Object.isFrozen(changedInsert)).toBe(true);
    expect(Reflect.ownKeys(changedConditional)).toEqual(['kind']);
  });

  it.each([
    ['plain record', { affectedRows: 1, insertId: 0n, warningStatus: 0 }],
    ['proxy', new Proxy(packet(1), {})],
    ['extra key', Object.assign(packet(1), { extra: true })],
    ['wrong affected rows', packet(2)],
    ['nonzero insert id', new OkPacket(1, 1n, 0)],
    ['warning', new OkPacket(1, 0n, 1)],
  ] as const)('fails closed for a %s packet', (_scenario, value): void => {
    expect(decodeConditional(value)).toEqual({ kind: 'malformed' });
    expect(decodeInsert(value)).toEqual({ kind: 'malformed' });
  });

  it('publishes opaque frozen identities in the fixed atomic rotation order', (): void => {
    expect(IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS).toEqual([
      IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
    ]);
    expect(Object.isFrozen(IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS)).toBe(true);

    for (const statement of IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS) {
      expect(Object.isFrozen(statement)).toBe(true);
      expect(Reflect.ownKeys(statement)).toEqual([]);
      expect(statement).not.toHaveProperty('text');
      expect(statement).not.toHaveProperty('decode');
      expect(statement).not.toHaveProperty('duplicateKeyFailures');
      expect(isProxy(statement)).toBe(false);
    }
  });

  it('does not add the private rotation statement slice to the supported Identity root', (): void => {
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS',
    );
  });
});
