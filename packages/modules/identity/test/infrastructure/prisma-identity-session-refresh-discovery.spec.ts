import { Prisma } from '@oms/database/prisma';

import * as identityPublicApi from '../../src';
import {
  consumeIdentitySessionRefreshDiscoveryFoundTicket,
  createIdentitySessionRefreshDiscoveryBoundaryAuthority,
  IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
  IdentitySessionRefreshDiscoveryPersistenceError,
  IdentitySessionRefreshDiscoveryUnavailableError,
  InvalidIdentitySessionRefreshDiscoveryTicketError,
} from '../../src/application/identity-session-refresh-discovery';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityRefreshCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import { InvalidIdentityRefreshCredentialDigestError } from '../../src/application/identity-session-credential.errors';
import * as identityPrismaApi from '../../src/infrastructure/prisma';
import {
  createPrismaIdentitySessionRefreshDiscovery,
  type IdentitySessionRefreshDiscoveryPrismaClient,
} from '../../src/infrastructure/prisma';
import { inspectPrismaIdentitySessionRefreshDiscoveryAuthority } from '../../src/infrastructure/prisma/prisma-identity-session-refresh-discovery';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const OTHER_SESSION_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const PRISMA_CLIENT_VERSION = '7.9.1';
const PERSISTENCE_MESSAGE = 'Identity session refresh discovery failed';

type QueryRawOperation = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
type DiscoveryRow = Readonly<{
  refresh_family_id: unknown;
  loaded_session_id: unknown;
  family_account_id: unknown;
  loaded_account_id: unknown;
  presented_refresh_credential_id: unknown;
}>;
type ClientFixture = Readonly<{
  client: IdentitySessionRefreshDiscoveryPrismaClient;
  queryRaw: jest.MockedFunction<QueryRawOperation>;
}>;
type QueryInvocation = Readonly<{
  sql: string;
  values: readonly unknown[];
}>;
type ErrorClass = abstract new (...arguments_: never[]) => Error;

function clientFixture(result: unknown = []): ClientFixture {
  const queryRaw = jest.fn<ReturnType<QueryRawOperation>, Parameters<QueryRawOperation>>();
  queryRaw.mockResolvedValue(result);

  return {
    client: {
      $queryRaw: queryRaw as IdentitySessionRefreshDiscoveryPrismaClient['$queryRaw'],
    },
    queryRaw,
  };
}

function digestBytes(seed = 23): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_unused, index): number => (seed + index * 17) & 0xff);
}

function refreshDigest(seed = 23): IdentityRefreshCredentialDigest {
  return createIdentityRefreshCredentialDigestFromBytes(digestBytes(seed));
}

function foundRow(overrides: Partial<DiscoveryRow> = {}): DiscoveryRow {
  return {
    refresh_family_id: SESSION_ID,
    loaded_session_id: SESSION_ID,
    family_account_id: ACCOUNT_ID,
    loaded_account_id: ACCOUNT_ID,
    presented_refresh_credential_id: CREDENTIAL_ID,
    ...overrides,
  };
}

function invocationOf(queryRaw: jest.MockedFunction<QueryRawOperation>): QueryInvocation {
  const invocation = queryRaw.mock.calls[0];

  if (invocation === undefined) {
    throw new Error('Expected one raw refresh-discovery query invocation');
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

function expectBoundDigestWiped(queryRaw: jest.MockedFunction<QueryRawOperation>): void {
  const boundDigest = invocationOf(queryRaw).values[0];

  expect(boundDigest).toBeInstanceOf(Uint8Array);
  expect([...(boundDigest as Uint8Array)]).toEqual(Array.from({ length: 32 }, (): number => 0));
}

function knownPrismaError(code: string): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return new Prisma.PrismaClientKnownRequestError('database vendor details', {
    clientVersion: PRISMA_CLIENT_VERSION,
    code,
  });
}

async function captureRejection(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to reject with an Error');
}

function captureSynchronousError(operation: () => unknown): Error {
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
  error: Error,
  ErrorClass: ErrorClass,
  message: string,
  rejectedValues: readonly string[] = [],
): void {
  expect(error).toBeInstanceOf(ErrorClass);
  expect(error).toMatchObject({ name: ErrorClass.name, message });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

describe('Prisma Identity session refresh discovery', (): void => {
  it('discovers one retained digest with an authentic paired ticket and lifecycle-blind SQL', async (): Promise<void> => {
    const fixture = clientFixture([foundRow()]);
    const expectedBytes = digestBytes();
    const digest = createIdentityRefreshCredentialDigestFromBytes(expectedBytes);
    let observedDuringQuery: Uint8Array<ArrayBuffer> | undefined;

    fixture.queryRaw.mockImplementation((_strings, ...values): Promise<unknown> => {
      const boundDigest = values.find(
        (value): value is Uint8Array<ArrayBuffer> =>
          value instanceof Uint8Array && value.byteLength === 32,
      );

      if (boundDigest === undefined) {
        throw new Error('Expected a bound binary refresh digest');
      }

      observedDuringQuery = Uint8Array.from(boundDigest);
      return Promise.resolve([foundRow()]);
    });

    const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);
    const ticket = await discovery.findByRefreshCredentialDigest(digest);

    expect(ticket).toEqual({
      kind: 'found',
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    });
    expect(Object.isFrozen(ticket)).toBe(true);
    expect(Object.isFrozen(discovery)).toBe(true);
    expect(Reflect.ownKeys(discovery)).toEqual([]);
    expect(fixture.queryRaw).toHaveBeenCalledTimes(1);
    expect(observedDuringQuery).toEqual(expectedBytes);

    const invocation = invocationOf(fixture.queryRaw);
    expectBoundDigestWiped(fixture.queryRaw);
    expect(invocation.values).toHaveLength(2);
    expect(invocation.values[1]).toBe(2);
    expect(invocation.sql).toContain('FROM identity_refresh_credentials AS refresh');
    expect(invocation.sql).toContain(
      'LEFT JOIN identity_session_families AS family ON family.id = refresh.family_id',
    );
    expect(invocation.sql).toContain(
      'LEFT JOIN identity_accounts AS account ON account.id = family.account_id',
    );
    expect(invocation.sql).toContain('WHERE refresh.digest = ?');
    expect(invocation.sql).toContain('LIMIT ?');
    expect(invocation.sql).toContain('AS refresh_family_id');
    expect(invocation.sql).toContain('AS loaded_session_id');
    expect(invocation.sql).toContain('AS family_account_id');
    expect(invocation.sql).toContain('AS loaded_account_id');
    expect(invocation.sql).toContain('AS presented_refresh_credential_id');
    expect(invocation.sql).not.toMatch(
      /SELECT \*|FOR UPDATE|CURRENT_TIMESTAMP|consumed_at|expires_at|idle_expires_at|absolute_expires_at|revoked_at|active_slot|successor_id|\bstatus\b|\bsequence\b/iu,
    );

    if (ticket.kind !== 'found') {
      throw new Error('Expected a found discovery ticket');
    }

    const authority = inspectPrismaIdentitySessionRefreshDiscoveryAuthority(discovery);
    const foreignAuthority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
    expect(() =>
      consumeIdentitySessionRefreshDiscoveryFoundTicket(foreignAuthority, ticket),
    ).toThrow(InvalidIdentitySessionRefreshDiscoveryTicketError);

    const consumed = consumeIdentitySessionRefreshDiscoveryFoundTicket(authority, ticket);
    expect(consumed).toEqual({
      refreshCredentialDigest: digest,
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    });
    expect(consumed.refreshCredentialDigest).toBe(digest);
  });

  it('returns the exact shared not-found result for an empty exact provider array', async (): Promise<void> => {
    const fixture = clientFixture([]);
    const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);

    await expect(discovery.findByRefreshCredentialDigest(refreshDigest())).resolves.toBe(
      IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
    );
    expect(fixture.queryRaw).toHaveBeenCalledTimes(1);
    expectBoundDigestWiped(fixture.queryRaw);
  });

  it('authenticates refresh-digest kind before issuing persistence work', async (): Promise<void> => {
    const fixture = clientFixture();
    const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);
    const authenticDigest = refreshDigest();
    const invalidDigests: readonly unknown[] = [
      {},
      digestBytes(),
      createIdentityAccessCredentialDigestFromBytes(digestBytes()),
      structuredClone(authenticDigest),
      new Proxy(authenticDigest, {}),
    ];

    for (const invalidDigest of invalidDigests) {
      await expect(
        discovery.findByRefreshCredentialDigest(invalidDigest as IdentityRefreshCredentialDigest),
      ).rejects.toBeInstanceOf(InvalidIdentityRefreshCredentialDigestError);
    }

    expect(fixture.queryRaw).not.toHaveBeenCalled();
  });

  it('maps a nominal transient Prisma failure to one fixed unavailable error', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw.mockRejectedValue(knownPrismaError('P1001'));
    const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);
    const error = await captureRejection(() =>
      discovery.findByRefreshCredentialDigest(refreshDigest()),
    );

    expectFixedError(
      error,
      IdentitySessionRefreshDiscoveryUnavailableError,
      'Identity session refresh discovery is temporarily unavailable',
      ['database vendor details'],
    );
    expectBoundDigestWiped(fixture.queryRaw);
  });

  it('maps every other query failure to persistence failure and wipes the digest copy', async (): Promise<void> => {
    const fixture = clientFixture();
    const vendorSecret = 'digest=vendor-secret sql=SELECT private';
    fixture.queryRaw.mockRejectedValue(new Error(vendorSecret));
    const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);
    const error = await captureRejection(() =>
      discovery.findByRefreshCredentialDigest(refreshDigest()),
    );

    expectFixedError(error, IdentitySessionRefreshDiscoveryPersistenceError, PERSISTENCE_MESSAGE, [
      vendorSecret,
    ]);

    expectBoundDigestWiped(fixture.queryRaw);
  });

  it.each([
    ['non-array result', { rows: [] }],
    ['sparse result', new Array<DiscoveryRow>(1)],
    ['overflow result', [foundRow(), foundRow()]],
    ['empty result with an extra member', Object.assign([], { unexpected: true })],
    ['found result with an extra member', Object.assign([foundRow()], { unexpected: true })],
    ['extra projected member', [{ ...foundRow(), unexpected: true }]],
    [
      'missing projected member',
      [
        {
          refresh_family_id: SESSION_ID,
          loaded_session_id: SESSION_ID,
          family_account_id: ACCOUNT_ID,
          loaded_account_id: ACCOUNT_ID,
        },
      ],
    ],
    ['orphaned family relationship', [foundRow({ loaded_session_id: null })]],
    ['orphaned account relationship', [foundRow({ loaded_account_id: null })]],
    ['mismatched family relationship', [foundRow({ loaded_session_id: OTHER_SESSION_ID })]],
    ['mismatched account relationship', [foundRow({ loaded_account_id: OTHER_ACCOUNT_ID })]],
    [
      'invalid account identifier',
      [foundRow({ family_account_id: 'not-a-uuid', loaded_account_id: 'not-a-uuid' })],
    ],
    [
      'invalid session identifier',
      [foundRow({ refresh_family_id: 'not-a-uuid', loaded_session_id: 'not-a-uuid' })],
    ],
    [
      'invalid credential identifier',
      [foundRow({ presented_refresh_credential_id: 'not-a-uuid' })],
    ],
  ] as const)('fails closed on a %s', async (_scenario, providerValue): Promise<void> => {
    const fixture = clientFixture(providerValue);
    const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);
    const error = await captureRejection(() =>
      discovery.findByRefreshCredentialDigest(refreshDigest()),
    );

    expectFixedError(error, IdentitySessionRefreshDiscoveryPersistenceError, PERSISTENCE_MESSAGE);
    expectBoundDigestWiped(fixture.queryRaw);
  });

  it('reads exact array data descriptors instead of a hostile length getter', async (): Promise<void> => {
    let hostileLengthReads = 0;
    const rows = new Proxy([foundRow()], {
      get(target, property, receiver): unknown {
        if (property === 'length') {
          hostileLengthReads += 1;
          return 0;
        }

        return Reflect.get(target, property, receiver);
      },
    });
    const fixture = clientFixture(rows);
    const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);

    await expect(discovery.findByRefreshCredentialDigest(refreshDigest())).resolves.toMatchObject({
      kind: 'found',
    });
    expect(hostileLengthReads).toBe(0);
  });

  it('rejects accessor and hostile rows without exposing provider details', async (): Promise<void> => {
    const providerSecret = 'hostile-refresh-row-secret';
    let accessorCalls = 0;
    const accessorRow = foundRow() as Record<string, unknown>;
    Object.defineProperty(accessorRow, 'family_account_id', {
      configurable: true,
      enumerable: true,
      get(): string {
        accessorCalls += 1;
        throw new Error(providerSecret);
      },
    });
    const hostileRow = new Proxy(foundRow(), {
      ownKeys(): never {
        throw new Error(providerSecret);
      },
    });
    const accessorRows: unknown[] = [foundRow()];
    Object.defineProperty(accessorRows, '0', {
      configurable: true,
      enumerable: true,
      get(): never {
        accessorCalls += 1;
        throw new Error(providerSecret);
      },
    });
    const hostileRows = new Proxy([foundRow()], {
      ownKeys(): never {
        throw new Error(providerSecret);
      },
    });

    for (const providerValue of [[accessorRow], [hostileRow], accessorRows, hostileRows]) {
      const fixture = clientFixture(providerValue);
      const discovery = createPrismaIdentitySessionRefreshDiscovery(fixture.client);
      const error = await captureRejection(() =>
        discovery.findByRefreshCredentialDigest(refreshDigest()),
      );

      expectFixedError(
        error,
        IdentitySessionRefreshDiscoveryPersistenceError,
        PERSISTENCE_MESSAGE,
        [providerSecret],
      );
    }

    expect(accessorCalls).toBe(0);
  });

  it('captures the original query method and preserves its receiver', async (): Promise<void> => {
    const capturedQueryRaw = jest.fn<
      ReturnType<QueryRawOperation>,
      Parameters<QueryRawOperation>
    >();
    capturedQueryRaw.mockResolvedValue([foundRow()]);
    const client: { $queryRaw: QueryRawOperation } = { $queryRaw: capturedQueryRaw };
    const discovery = createPrismaIdentitySessionRefreshDiscovery(
      client as IdentitySessionRefreshDiscoveryPrismaClient,
    );
    client.$queryRaw = (): Promise<unknown> =>
      Promise.reject(new Error('mutated query method must not run'));

    await expect(discovery.findByRefreshCredentialDigest(refreshDigest())).resolves.toMatchObject({
      kind: 'found',
    });
    expect(capturedQueryRaw).toHaveBeenCalledTimes(1);
    expect(capturedQueryRaw.mock.contexts[0]).toBe(client);
  });

  it('seals the hidden runtime constructor and prototype', (): void => {
    const discovery = createPrismaIdentitySessionRefreshDiscovery(clientFixture().client);
    const runtime = discovery as unknown as Readonly<{ constructor: unknown }>;
    const recoveredConstructor = runtime.constructor;

    if (typeof recoveredConstructor !== 'function') {
      throw new Error('Expected the discovery runtime constructor to be callable');
    }

    for (const argumentsList of [[], [Object.freeze({})], [Object.freeze({}), Object.freeze({})]]) {
      const error = captureSynchronousError((): void => {
        Reflect.construct(recoveredConstructor, argumentsList);
      });

      expectFixedError(error, IdentitySessionRefreshDiscoveryPersistenceError, PERSISTENCE_MESSAGE);
    }

    expect(Object.isFrozen(Object.getPrototypeOf(discovery))).toBe(true);
    expect(Object.isFrozen(recoveredConstructor)).toBe(true);
  });

  it('rejects invalid dependencies and forged inspectors with one fixed persistence error', (): void => {
    const dependencySecret = 'refresh-client-getter-secret';
    const throwingClient = Object.defineProperty({}, '$queryRaw', {
      get(): never {
        throw new Error(dependencySecret);
      },
    });
    const invalidDependencies: readonly unknown[] = [null, {}, { $queryRaw: true }, throwingClient];

    for (const invalidDependency of invalidDependencies) {
      const error = captureSynchronousError(() =>
        createPrismaIdentitySessionRefreshDiscovery(
          invalidDependency as IdentitySessionRefreshDiscoveryPrismaClient,
        ),
      );
      expectFixedError(
        error,
        IdentitySessionRefreshDiscoveryPersistenceError,
        PERSISTENCE_MESSAGE,
        [dependencySecret],
      );
    }

    const inspectionError = captureSynchronousError(() =>
      inspectPrismaIdentitySessionRefreshDiscoveryAuthority(Object.freeze({})),
    );
    expectFixedError(
      inspectionError,
      IdentitySessionRefreshDiscoveryPersistenceError,
      PERSISTENCE_MESSAGE,
    );
  });

  it('exports only the reviewed factory from the Prisma subpath and keeps discovery internal at root', (): void => {
    expect(identityPrismaApi.createPrismaIdentitySessionRefreshDiscovery).toBe(
      createPrismaIdentitySessionRefreshDiscovery,
    );
    expect(identityPrismaApi).not.toHaveProperty(
      'inspectPrismaIdentitySessionRefreshDiscoveryAuthority',
    );

    for (const internalName of [
      'createPrismaIdentitySessionRefreshDiscovery',
      'inspectPrismaIdentitySessionRefreshDiscoveryAuthority',
      'IdentitySessionRefreshDiscoveryPersistenceError',
    ]) {
      expect(identityPublicApi).not.toHaveProperty(internalName);
    }
  });
});
