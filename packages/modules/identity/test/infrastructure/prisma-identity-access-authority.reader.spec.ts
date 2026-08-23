import { Prisma } from '@oms/database/prisma';

import {
  IDENTITY_ACCESS_AUTHORITY_REJECTED,
  type IdentityAccessAuthorityResult,
} from '../../src/application/identity-access-authority.reader';
import {
  IdentityAccessAuthorityPersistenceError,
  IdentityAccessAuthorityUnavailableError,
} from '../../src/application/identity-access-authority.errors';
import { InvalidIdentityAuthenticatedPrincipalError } from '../../src/application/identity-authenticated-principal.errors';
import {
  createIdentityAccessCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import { InvalidIdentityAccessCredentialDigestError } from '../../src/application/identity-session-credential.errors';
import {
  PrismaIdentityAccessAuthorityReader,
  type IdentityAccessAuthorityPrismaClient,
} from '../../src/infrastructure/prisma';

const ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const OTHER_ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ac';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const OTHER_SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ac';
const ROLE_ONE_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const ROLE_TWO_ID = '01890f3a-8bcd-7def-aabc-0123456789ac';
const PRISMA_CLIENT_VERSION = '7.9.1';

type QueryRawOperation = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
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

type ClientFixture = Readonly<{
  client: IdentityAccessAuthorityPrismaClient;
  queryRaw: jest.MockedFunction<QueryRawOperation>;
}>;

type QueryInvocation = Readonly<{
  sql: string;
  values: readonly unknown[];
}>;

function clientFixture(result: unknown = []): ClientFixture {
  const queryRaw = jest.fn<ReturnType<QueryRawOperation>, Parameters<QueryRawOperation>>();
  queryRaw.mockResolvedValue(result);

  return {
    client: {
      $queryRaw: queryRaw as IdentityAccessAuthorityPrismaClient['$queryRaw'],
    },
    queryRaw,
  };
}

function accessDigest(seed = 7): IdentityAccessCredentialDigest {
  return createIdentityAccessCredentialDigestFromBytes(
    Uint8Array.from({ length: 32 }, (_value, index): number => (seed + index) % 256),
  );
}

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

function invocationOf(queryRaw: jest.MockedFunction<QueryRawOperation>): QueryInvocation {
  const invocation = queryRaw.mock.calls[0];

  if (invocation === undefined) {
    throw new Error('Expected one raw authority-query invocation');
  }

  const [strings, ...values] = invocation;
  const sql = strings
    .reduce(
      (statement, segment, index): string =>
        `${statement}${segment}${index < values.length ? '?' : ''}`,
      '',
    )
    .replaceAll(/\s+/gu, ' ')
    .trim();

  return { sql, values };
}

function permissionCode(index: number): string {
  return `catalog.test.permission-${String(index).padStart(3, '0')}`;
}

function roleId(index: number): string {
  return `01890f3a-8bcd-7def-aabc-${String(index).padStart(12, '0')}`;
}

function knownPrismaError(code: string): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return new Prisma.PrismaClientKnownRequestError('database vendor details', {
    clientVersion: PRISMA_CLIENT_VERSION,
    code,
  });
}

async function resolve(
  rows: unknown,
  digest = accessDigest(),
): Promise<IdentityAccessAuthorityResult> {
  const fixture = clientFixture(rows);
  const reader = new PrismaIdentityAccessAuthorityReader(fixture.client);

  return reader.resolveByAccessCredentialDigest(digest);
}

describe('PrismaIdentityAccessAuthorityReader', (): void => {
  it('runs one bounded writer-time statement and wipes its authenticated digest copy', async (): Promise<void> => {
    const fixture = clientFixture([noRoleRow()]);
    const digestBytes = Uint8Array.from({ length: 32 }, (_value, index): number => index + 1);
    const digest = createIdentityAccessCredentialDigestFromBytes(digestBytes);
    let bytesObservedDuringQuery: Uint8Array | undefined;

    fixture.queryRaw.mockImplementation((_strings, ...values): Promise<unknown> => {
      const boundDigest = values.find(
        (value): value is Uint8Array => value instanceof Uint8Array && value.byteLength === 32,
      );

      if (boundDigest === undefined) {
        throw new Error('Expected a bound binary credential digest');
      }

      bytesObservedDuringQuery = Uint8Array.from(boundDigest);
      return Promise.resolve([noRoleRow()]);
    });

    const reader = new PrismaIdentityAccessAuthorityReader(fixture.client);
    await expect(reader.resolveByAccessCredentialDigest(digest)).resolves.toMatchObject({
      kind: 'resolved',
    });

    expect(fixture.queryRaw).toHaveBeenCalledTimes(1);
    expect(bytesObservedDuringQuery).toEqual(digestBytes);

    const invocation = invocationOf(fixture.queryRaw);
    const boundDigest = invocation.values.find(
      (value): value is Uint8Array => value instanceof Uint8Array && value.byteLength === 32,
    );

    if (boundDigest === undefined) {
      throw new Error('Expected the query to retain its bound digest argument');
    }

    expect([...boundDigest]).toEqual(Array.from({ length: 32 }, (): number => 0));
    expect(invocation.values.at(-1)).toBe(2_049);
    expect(invocation.sql.match(/CURRENT_TIMESTAMP\(6\)/gu)).toHaveLength(1);
    expect(invocation.sql).toContain('WITH authority_clock AS');
    expect(invocation.sql).toContain('LIMIT ?');
    expect(invocation.sql).not.toMatch(/GROUP_CONCAT|ORDER BY|SELECT \*/u);
  });

  it('deduplicates shared permissions, ASCII-sorts them, and freezes the result', async (): Promise<void> => {
    const result = await resolve([
      resolvedRow({
        assigned_role_id: ROLE_TWO_ID,
        loaded_role_id: ROLE_TWO_ID,
        mapped_permission_code: 'catalog.skus.write',
        permission_code: 'catalog.skus.write',
      }),
      resolvedRow({
        mapped_permission_code: 'catalog.products.read',
        permission_code: 'catalog.products.read',
      }),
      resolvedRow({
        assigned_role_id: ROLE_TWO_ID,
        loaded_role_id: ROLE_TWO_ID,
        mapped_permission_code: 'catalog.products.read',
        permission_code: 'catalog.products.read',
      }),
    ]);

    expect(result).toEqual({
      kind: 'resolved',
      principal: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        permissions: ['catalog.products.read', 'catalog.skus.write'],
      },
    });

    if (result.kind !== 'resolved') {
      throw new Error('Expected resolved authority');
    }

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.principal)).toBe(true);
    expect(Object.isFrozen(result.principal.permissions)).toBe(true);
  });

  it.each([
    ['no role assignments', [noRoleRow()]],
    [
      'only retired roles',
      [
        resolvedRow({
          role_status: 'RETIRED',
          mapped_permission_code: null,
          permission_code: null,
        }),
      ],
    ],
  ])('resolves an authenticated principal with no permissions for %s', async (_label, rows) => {
    await expect(resolve(rows)).resolves.toEqual({
      kind: 'resolved',
      principal: {
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        permissions: [],
      },
    });
  });

  it('uses one frozen rejection for an unknown digest and every lifecycle rejection', async (): Promise<void> => {
    await expect(resolve([])).resolves.toBe(IDENTITY_ACCESS_AUTHORITY_REJECTED);
    await expect(resolve([rejectedRow()])).resolves.toBe(IDENTITY_ACCESS_AUTHORITY_REJECTED);
    expect(Object.isFrozen(IDENTITY_ACCESS_AUTHORITY_REJECTED)).toBe(true);
  });

  it.each([
    ['corrupt query classification', [rejectedRow({ authority_state: 'CORRUPT' })]],
    ['unknown query classification', [rejectedRow({ authority_state: 'UNKNOWN' })]],
    ['rejection carrying an actor', [rejectedRow({ actor_id: ACTOR_ID })]],
    ['multiple rejection rows', [rejectedRow(), rejectedRow()]],
    ['mismatched actor projections', [resolvedRow(), resolvedRow({ actor_id: OTHER_ACTOR_ID })]],
    [
      'mismatched session projections',
      [resolvedRow(), resolvedRow({ session_id: OTHER_SESSION_ID })],
    ],
    ['permission without an assignment', [noRoleRow(), resolvedRow()]],
    ['missing loaded role', [resolvedRow({ loaded_role_id: null })]],
    ['different loaded role', [resolvedRow({ loaded_role_id: ROLE_TWO_ID })]],
    ['unknown role status', [resolvedRow({ role_status: 'DISABLED' })]],
    [
      'inconsistent repeated role status',
      [
        resolvedRow(),
        resolvedRow({
          role_status: 'RETIRED',
          mapped_permission_code: null,
          permission_code: null,
        }),
      ],
    ],
    [
      'duplicate retired-role projection',
      [
        resolvedRow({
          role_status: 'RETIRED',
          mapped_permission_code: null,
          permission_code: null,
        }),
        resolvedRow({
          role_status: 'RETIRED',
          mapped_permission_code: null,
          permission_code: null,
        }),
      ],
    ],
    [
      'retired role carrying a mapping',
      [resolvedRow({ role_status: 'RETIRED', permission_code: null })],
    ],
    ['mapping without a registry permission', [resolvedRow({ permission_code: null })]],
    [
      'different mapping and registry permissions',
      [resolvedRow({ permission_code: 'catalog.skus.read' })],
    ],
    ['duplicate role-permission pair', [resolvedRow(), resolvedRow()]],
    [
      'active role projected both empty and mapped',
      [resolvedRow({ mapped_permission_code: null, permission_code: null }), resolvedRow()],
    ],
    ['invalid actor identifier', [resolvedRow({ actor_id: 'not-a-uuid' })]],
    ['invalid role identifier', [resolvedRow({ assigned_role_id: 'not-a-uuid' })]],
    ['invalid permission code', [resolvedRow({ permission_code: 'INVALID' })]],
    ['non-array provider result', { rows: [] }],
    ['row with an extra field', [{ ...resolvedRow(), unexpected: true }]],
  ])('fails closed on %s', async (_label, rows): Promise<void> => {
    await expect(resolve(rows)).rejects.toEqual(new InvalidIdentityAuthenticatedPrincipalError());
  });

  it('rejects sparse provider arrays before producing authority', async (): Promise<void> => {
    const rows = new Array<AuthorityRow>(2);
    rows[0] = resolvedRow();

    await expect(resolve(rows)).rejects.toBeInstanceOf(InvalidIdentityAuthenticatedPrincipalError);
  });

  it('fails closed above the active-role bound', async (): Promise<void> => {
    const rows = Array.from({ length: 17 }, (_value, index): AuthorityRow =>
      resolvedRow({
        assigned_role_id: roleId(index),
        loaded_role_id: roleId(index),
        mapped_permission_code: null,
        permission_code: null,
      }),
    );

    await expect(resolve(rows)).rejects.toBeInstanceOf(InvalidIdentityAuthenticatedPrincipalError);
  });

  it('fails closed above the distinct-permission bound', async (): Promise<void> => {
    const rows = Array.from({ length: 129 }, (_value, index): AuthorityRow => {
      const permission = permissionCode(index);

      return resolvedRow({
        mapped_permission_code: permission,
        permission_code: permission,
      });
    });

    await expect(resolve(rows)).rejects.toBeInstanceOf(InvalidIdentityAuthenticatedPrincipalError);
  });

  it('uses the 2,049th row only as an overflow sentinel', async (): Promise<void> => {
    const rows = Array.from({ length: 2_049 }, noRoleRow);

    await expect(resolve(rows)).rejects.toBeInstanceOf(InvalidIdentityAuthenticatedPrincipalError);
  });

  it('authenticates the digest before persistence and never queries for a forged value', async (): Promise<void> => {
    const fixture = clientFixture();
    const reader = new PrismaIdentityAccessAuthorityReader(fixture.client);

    await expect(
      reader.resolveByAccessCredentialDigest({} as IdentityAccessCredentialDigest),
    ).rejects.toBeInstanceOf(InvalidIdentityAccessCredentialDigestError);
    expect(fixture.queryRaw).not.toHaveBeenCalled();
  });

  it('translates a nominal transient Prisma failure to a fixed unavailable error', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw.mockRejectedValue(knownPrismaError('P1001'));
    const reader = new PrismaIdentityAccessAuthorityReader(fixture.client);

    await expect(reader.resolveByAccessCredentialDigest(accessDigest())).rejects.toEqual(
      new IdentityAccessAuthorityUnavailableError(),
    );
  });

  it('translates every other query failure to a fixed persistence error', async (): Promise<void> => {
    const fixture = clientFixture();
    const vendorError = new Error('digest=secret sql=SELECT everything');
    fixture.queryRaw.mockRejectedValue(vendorError);
    const reader = new PrismaIdentityAccessAuthorityReader(fixture.client);

    await expect(reader.resolveByAccessCredentialDigest(accessDigest())).rejects.toEqual(
      new IdentityAccessAuthorityPersistenceError(),
    );
  });

  it('wipes the digest copy when the query rejects', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw.mockRejectedValue(new Error('query failed'));
    const reader = new PrismaIdentityAccessAuthorityReader(fixture.client);

    await expect(reader.resolveByAccessCredentialDigest(accessDigest())).rejects.toBeInstanceOf(
      IdentityAccessAuthorityPersistenceError,
    );

    const digestArgument = invocationOf(fixture.queryRaw).values.find(
      (value): value is Uint8Array => value instanceof Uint8Array && value.byteLength === 32,
    );

    if (digestArgument === undefined) {
      throw new Error('Expected the query to retain its bound digest argument');
    }

    expect([...digestArgument]).toEqual(Array.from({ length: 32 }, (): number => 0));
  });
});
