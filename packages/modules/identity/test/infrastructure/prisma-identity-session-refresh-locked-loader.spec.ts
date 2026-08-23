import { inspect } from 'node:util';

import { Prisma } from '@oms/database/prisma';

import * as identityPublicApi from '../../src';
import {
  IdentitySessionRefreshLockedLoadPersistenceError,
  IdentitySessionRefreshLockedLoadUnavailableError,
} from '../../src/application/identity-session-refresh-locked-loader';
import {
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityRefreshCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import {
  InvalidIdentitySessionRefreshDiscoveryTicketError,
  type IdentitySessionRefreshDiscovery,
  type IdentitySessionRefreshDiscoveryFoundTicket,
} from '../../src/application/identity-session-refresh-discovery';
import {
  activateIdentitySessionRefreshWorkflow,
  createIdentitySessionRefreshWorkflow,
  InvalidIdentitySessionRefreshWorkflowError,
  type IdentitySessionRefreshWorkflowBoundary,
} from '../../src/application/identity-session-refresh-workflow';
import * as identityPrismaApi from '../../src/infrastructure/prisma';
import {
  createPrismaIdentitySessionRefreshDiscovery,
  type IdentitySessionRefreshDiscoveryPrismaClient,
} from '../../src/infrastructure/prisma';
import {
  createPrismaIdentitySessionRefreshLockedLoader,
  type IdentitySessionRefreshLockedLoaderPrismaTransactionClient,
} from '../../src/infrastructure/prisma/prisma-identity-session-refresh-locked-loader';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const OTHER_SESSION_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const SUCCESSOR_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const ACCOUNT_CREATED_AT = '2026-08-23T09:00:00.000001Z';
const FAMILY_CREATED_AT = '2026-08-23T10:00:00.000001Z';
const INITIAL_IDLE_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const ROTATED_AT = '2026-08-23T10:05:00.000002Z';
const ROTATED_IDLE_EXPIRES_AT = '2026-08-23T10:20:00.000002Z';
const REVOKED_AT = '2026-08-23T10:06:00.000003Z';
const DB_NOW = '2026-08-23T10:06:00.000003Z';
const EXPIRED_DB_NOW = '2026-08-25T10:00:00.000004Z';
const PRISMA_CLIENT_VERSION = '7.9.1';
const PERSISTENCE_MESSAGE = 'Identity session refresh locked load failed';
const UNAVAILABLE_MESSAGE = 'Identity session refresh locked load is temporarily unavailable';

type QueryRawOperation = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
type ErrorClass = abstract new (...arguments_: never[]) => Error;
type UnknownRow = Readonly<Record<string, unknown>>;
type QueryInvocation = Readonly<{
  sql: string;
  values: readonly unknown[];
}>;
type WriterFixture = Readonly<{
  client: IdentitySessionRefreshDiscoveryPrismaClient;
  queryRaw: jest.MockedFunction<QueryRawOperation>;
}>;
type TransactionFixture = Readonly<{
  client: IdentitySessionRefreshLockedLoaderPrismaTransactionClient;
  queryRaw: jest.MockedFunction<QueryRawOperation>;
}>;
type LockedLoaderFixture = Readonly<{
  boundary: IdentitySessionRefreshWorkflowBoundary;
  discovery: IdentitySessionRefreshDiscovery;
  digest: IdentityRefreshCredentialDigest;
  loader: ReturnType<typeof createPrismaIdentitySessionRefreshLockedLoader>;
  scope: ReturnType<typeof activateIdentitySessionRefreshWorkflow>['scope'];
  ticket: IdentitySessionRefreshDiscoveryFoundTicket;
  transaction: TransactionFixture;
  writer: WriterFixture;
}>;

function digestBytes(seed = 37): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_unused, index): number => (seed + index * 19) & 0xff);
}

function refreshDigest(seed = 37): IdentityRefreshCredentialDigest {
  return createIdentityRefreshCredentialDigestFromBytes(digestBytes(seed));
}

function discoveryRow(): UnknownRow {
  return {
    refresh_family_id: SESSION_ID,
    loaded_session_id: SESSION_ID,
    family_account_id: ACCOUNT_ID,
    loaded_account_id: ACCOUNT_ID,
    presented_refresh_credential_id: CREDENTIAL_ID,
  };
}

function accountRow(overrides: Readonly<Record<string, unknown>> = {}): UnknownRow {
  return {
    account_id: ACCOUNT_ID,
    account_login_name: 'system.admin',
    account_status: 'ACTIVE',
    account_version: 1n,
    account_created_at: ACCOUNT_CREATED_AT,
    account_updated_at: ACCOUNT_CREATED_AT,
    account_suspended_at: null,
    account_deactivated_at: null,
    ...overrides,
  };
}

function familyRow(overrides: Readonly<Record<string, unknown>> = {}): UnknownRow {
  return {
    session_id: SESSION_ID,
    session_account_id: ACCOUNT_ID,
    session_version: 1n,
    session_created_at: FAMILY_CREATED_AT,
    session_last_rotated_at: FAMILY_CREATED_AT,
    session_idle_expires_at: INITIAL_IDLE_EXPIRES_AT,
    session_absolute_expires_at: ABSOLUTE_EXPIRES_AT,
    session_revoked_at: null,
    session_closed_reason: null,
    ...overrides,
  };
}

function refreshRow(overrides: Readonly<Record<string, unknown>> = {}): UnknownRow {
  return {
    refresh_credential_id: CREDENTIAL_ID,
    refresh_family_id: SESSION_ID,
    refresh_sequence: 1n,
    refresh_issued_at: FAMILY_CREATED_AT,
    refresh_expires_at: INITIAL_IDLE_EXPIRES_AT,
    refresh_consumed_at: null,
    refresh_successor_id: null,
    refresh_active_slot: 1,
    ...overrides,
  };
}

function retainedReplayRows(): readonly [UnknownRow, UnknownRow, UnknownRow] {
  return [
    accountRow({
      account_status: 'SUSPENDED',
      account_version: 2n,
      account_updated_at: ROTATED_AT,
      account_suspended_at: ROTATED_AT,
    }),
    familyRow({
      session_version: 3n,
      session_last_rotated_at: ROTATED_AT,
      session_idle_expires_at: ROTATED_IDLE_EXPIRES_AT,
      session_revoked_at: REVOKED_AT,
      session_closed_reason: 'REFRESH_REUSE_DETECTED',
    }),
    refreshRow({
      refresh_consumed_at: ROTATED_AT,
      refresh_successor_id: SUCCESSOR_CREDENTIAL_ID,
      refresh_active_slot: null,
    }),
  ];
}

function writerFixture(result: unknown = [discoveryRow()]): WriterFixture {
  const queryRaw = jest.fn<ReturnType<QueryRawOperation>, Parameters<QueryRawOperation>>();
  queryRaw.mockResolvedValue(result);

  return {
    client: {
      $queryRaw: queryRaw as IdentitySessionRefreshDiscoveryPrismaClient['$queryRaw'],
    },
    queryRaw,
  };
}

function transactionFixture(
  results: readonly unknown[] = [[accountRow()], [familyRow()], [refreshRow()]],
): TransactionFixture {
  const queryRaw = jest.fn<ReturnType<QueryRawOperation>, Parameters<QueryRawOperation>>();

  for (const result of results) {
    queryRaw.mockResolvedValueOnce(result);
  }

  return {
    client: {
      $queryRaw: queryRaw as IdentitySessionRefreshLockedLoaderPrismaTransactionClient['$queryRaw'],
    },
    queryRaw,
  };
}

async function foundTicket(
  discovery: IdentitySessionRefreshDiscovery,
  digest: IdentityRefreshCredentialDigest,
): Promise<IdentitySessionRefreshDiscoveryFoundTicket> {
  const result = await discovery.findByRefreshCredentialDigest(digest);

  if (result.kind !== 'found') {
    throw new Error('Expected a found refresh-discovery ticket');
  }

  return result;
}

async function lockedLoaderFixture(
  transaction = transactionFixture(),
  dbNow = DB_NOW,
): Promise<LockedLoaderFixture> {
  const writer = writerFixture();
  const digest = refreshDigest();
  const discovery = createPrismaIdentitySessionRefreshDiscovery(writer.client);
  const ticket = await foundTicket(discovery, digest);
  const boundary = createIdentitySessionRefreshWorkflow();
  const context = activateIdentitySessionRefreshWorkflow(boundary.controller, dbNow);
  const loader = createPrismaIdentitySessionRefreshLockedLoader(
    writer.client,
    transaction.client,
    discovery,
    boundary.controller,
  );

  return {
    boundary,
    discovery,
    digest,
    loader,
    scope: context.scope,
    ticket,
    transaction,
    writer,
  };
}

function invocationOf(
  queryRaw: jest.MockedFunction<QueryRawOperation>,
  index: number,
): QueryInvocation {
  const invocation = queryRaw.mock.calls[index];

  if (invocation === undefined) {
    throw new Error(`Expected raw query invocation ${String(index)}`);
  }

  const [strings, ...values] = invocation;
  const sql = strings
    .reduce(
      (statement, segment, valueIndex): string =>
        `${statement}${segment}${valueIndex < values.length ? '?' : ''}`,
      '',
    )
    .replaceAll(/\s+/gu, ' ')
    .trim();

  return { sql, values };
}

function boundDigestOf(
  queryRaw: jest.MockedFunction<QueryRawOperation>,
  index = 2,
): Uint8Array<ArrayBuffer> {
  const digest = invocationOf(queryRaw, index).values.find(
    (value): value is Uint8Array<ArrayBuffer> => value instanceof Uint8Array,
  );

  if (digest === undefined) {
    throw new Error('Expected a bound binary refresh digest');
  }

  return digest;
}

function expectDigestWiped(queryRaw: jest.MockedFunction<QueryRawOperation>, index = 2): void {
  expect([...boundDigestOf(queryRaw, index)]).toEqual(Array.from({ length: 32 }, (): number => 0));
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
  ErrorType: ErrorClass,
  message: string,
  forbidden: readonly string[] = [],
): void {
  expect(error).toBeInstanceOf(ErrorType);
  expect(Object.getPrototypeOf(error)).toBe(ErrorType.prototype);
  expect(error.name).toBe(ErrorType.name);
  expect(error.message).toBe(message);
  expect(Object.hasOwn(error, 'cause')).toBe(false);
  expect(Object.getOwnPropertyDescriptor(error, 'cause')).toBeUndefined();

  const rendered = inspect(error, { showHidden: true });
  for (const value of forbidden) {
    expect(rendered).not.toContain(value);
  }
}

function queryFailureFixture(stage: 0 | 1 | 2, error: Error): TransactionFixture {
  const transaction = transactionFixture([]);
  const preceding = [[accountRow()], [familyRow()]];

  for (let index = 0; index < stage; index += 1) {
    transaction.queryRaw.mockResolvedValueOnce(preceding[index]);
  }

  transaction.queryRaw.mockRejectedValueOnce(error);
  return transaction;
}

describe('Prisma Identity session refresh locked loader', (): void => {
  it('locks Account, SessionFamily, and exact RefreshCredential in the global order', async (): Promise<void> => {
    const expectedDigest = digestBytes();
    const fixture = await lockedLoaderFixture(transactionFixture([]));
    let observedDigestDuringQuery: Uint8Array<ArrayBuffer> | undefined;

    fixture.transaction.queryRaw.mockImplementationOnce((_strings, ...values): Promise<unknown> => {
      expect(values).toEqual([ACCOUNT_ID, 2]);
      return Promise.resolve([accountRow()]);
    });
    fixture.transaction.queryRaw.mockImplementationOnce((_strings, ...values): Promise<unknown> => {
      expect(values).toEqual([SESSION_ID, ACCOUNT_ID, 2]);
      return Promise.resolve([familyRow()]);
    });
    fixture.transaction.queryRaw.mockImplementationOnce((_strings, ...values): Promise<unknown> => {
      const digest = values[2];

      if (!(digest instanceof Uint8Array)) {
        throw new Error('Expected the refresh digest bind');
      }

      observedDigestDuringQuery = Uint8Array.from(digest);
      expect(values[0]).toBe(CREDENTIAL_ID);
      expect(values[1]).toBe(SESSION_ID);
      expect(values[3]).toBe(2);
      return Promise.resolve([refreshRow()]);
    });

    const result = await fixture.loader.loadForUpdate(fixture.scope, fixture.ticket);

    expect(result.kind).toBe('found');
    expect(Object.isFrozen(result)).toBe(true);
    expect(fixture.transaction.queryRaw).toHaveBeenCalledTimes(3);
    expect(observedDigestDuringQuery).toEqual(expectedDigest);
    expectDigestWiped(fixture.transaction.queryRaw);

    const accountQuery = invocationOf(fixture.transaction.queryRaw, 0);
    const familyQuery = invocationOf(fixture.transaction.queryRaw, 1);
    const refreshQuery = invocationOf(fixture.transaction.queryRaw, 2);

    expect(accountQuery.sql).toContain('FROM identity_accounts AS account FORCE INDEX (PRIMARY)');
    expect(accountQuery.sql).toContain('WHERE account.id = UUID_TO_BIN(?, 0) LIMIT ? FOR UPDATE');
    expect(familyQuery.sql).toContain(
      'FROM identity_session_families AS family FORCE INDEX (PRIMARY)',
    );
    expect(familyQuery.sql).toContain(
      'WHERE family.id = UUID_TO_BIN(?, 0) AND family.account_id = UUID_TO_BIN(?, 0) LIMIT ? FOR UPDATE',
    );
    expect(refreshQuery.sql).toContain(
      'FROM identity_refresh_credentials AS refresh FORCE INDEX (PRIMARY)',
    );
    expect(refreshQuery.sql).toContain(
      'WHERE refresh.id = UUID_TO_BIN(?, 0) AND refresh.family_id = UUID_TO_BIN(?, 0) AND refresh.digest = ? LIMIT ? FOR UPDATE',
    );

    for (const query of [accountQuery, familyQuery, refreshQuery]) {
      expect(query.sql.match(/FORCE INDEX \(PRIMARY\)/gu)).toHaveLength(1);
      expect(query.sql.match(/FOR UPDATE/gu)).toHaveLength(1);
      expect(query.sql).not.toMatch(/\bJOIN\b|SELECT \*/iu);
    }

    expect(accountQuery.sql.match(/DATE_FORMAT\(/gu)).toHaveLength(4);
    expect(familyQuery.sql.match(/DATE_FORMAT\(/gu)).toHaveLength(5);
    expect(refreshQuery.sql.match(/DATE_FORMAT\(/gu)).toHaveLength(3);
    for (const query of [accountQuery, familyQuery, refreshQuery]) {
      expect(query.sql).toContain("'%Y-%m-%dT%H:%i:%s.%fZ'");
    }

    if (result.kind !== 'found') {
      throw new Error('Expected a found locked load');
    }

    expect(result.account.toSnapshot()).toEqual({
      id: ACCOUNT_ID,
      loginName: 'system.admin',
      status: 'ACTIVE',
      version: 1,
      createdAt: ACCOUNT_CREATED_AT,
      updatedAt: ACCOUNT_CREATED_AT,
      suspendedAt: null,
      deactivatedAt: null,
    });
    expect(result.sessionFamily.toSnapshot()).toEqual({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      version: 1,
      createdAt: FAMILY_CREATED_AT,
      lastRotatedAt: FAMILY_CREATED_AT,
      refreshIdleExpiresAt: INITIAL_IDLE_EXPIRES_AT,
      refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
      revokedAt: null,
      closedReason: null,
    });
    expect(result.presentedRefreshCredential.toSnapshot()).toEqual({
      id: CREDENTIAL_ID,
      sessionId: SESSION_ID,
      sequence: 1,
      issuedAt: FAMILY_CREATED_AT,
      expiresAt: INITIAL_IDLE_EXPIRES_AT,
      consumedAt: null,
      successorId: null,
    });
  });

  it('loads retained replay evidence without lifecycle predicates', async (): Promise<void> => {
    const transaction = transactionFixture(retainedReplayRows().map((row) => [row]));
    const fixture = await lockedLoaderFixture(transaction, EXPIRED_DB_NOW);
    const result = await fixture.loader.loadForUpdate(fixture.scope, fixture.ticket);

    expect(result.kind).toBe('found');
    if (result.kind !== 'found') {
      throw new Error('Expected retained replay evidence');
    }

    expect(result.account.toSnapshot()).toMatchObject({ status: 'SUSPENDED', version: 2 });
    expect(result.sessionFamily.toSnapshot()).toMatchObject({
      version: 3,
      revokedAt: REVOKED_AT,
      closedReason: 'REFRESH_REUSE_DETECTED',
    });
    expect(result.presentedRefreshCredential.toSnapshot()).toMatchObject({
      consumedAt: ROTATED_AT,
      successorId: SUCCESSOR_CREDENTIAL_ID,
    });

    for (let index = 0; index < 3; index += 1) {
      const sql = invocationOf(transaction.queryRaw, index).sql;
      const predicate = sql.slice(sql.indexOf('WHERE'));

      expect(sql).not.toContain('CURRENT_TIMESTAMP');
      expect(predicate).not.toMatch(
        /account\.status|family\.(?:revoked_at|idle_expires_at|absolute_expires_at)|refresh\.(?:consumed_at|expires_at|active_slot|successor_id)/iu,
      );
    }
    expectDigestWiped(transaction.queryRaw);
  });

  it.each([0, 1, 2] as const)(
    'returns authentic locked not-found when lock stage %i has no row',
    async (emptyStage): Promise<void> => {
      const rows: unknown[] = [[accountRow()], [familyRow()], [refreshRow()]];
      rows[emptyStage] = [];
      const transaction = transactionFixture(rows);
      const fixture = await lockedLoaderFixture(transaction);

      await expect(fixture.loader.loadForUpdate(fixture.scope, fixture.ticket)).resolves.toEqual({
        kind: 'not-found',
      });
      expect(transaction.queryRaw).toHaveBeenCalledTimes(emptyStage + 1);
      if (emptyStage === 2) {
        expectDigestWiped(transaction.queryRaw);
      }
    },
  );

  it('authenticates scope and ticket identity before transaction SQL', async (): Promise<void> => {
    const fixture = await lockedLoaderFixture();
    const foreignBoundary = createIdentitySessionRefreshWorkflow();
    const foreignContext = activateIdentitySessionRefreshWorkflow(
      foreignBoundary.controller,
      DB_NOW,
    );

    await expect(
      fixture.loader.loadForUpdate(foreignContext.scope, fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      fixture.loader.loadForUpdate(structuredClone(fixture.scope), fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      fixture.loader.loadForUpdate(fixture.scope, structuredClone(fixture.ticket)),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshDiscoveryTicketError);
    await expect(
      fixture.loader.loadForUpdate(fixture.scope, new Proxy(fixture.ticket, {})),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshDiscoveryTicketError);

    expect(fixture.transaction.queryRaw).not.toHaveBeenCalled();
    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).resolves.toMatchObject({ kind: 'found' });
    expect(fixture.transaction.queryRaw).toHaveBeenCalledTimes(3);
  });

  it('rejects a ticket from another discovery before SQL without consuming the paired ticket', async (): Promise<void> => {
    const fixture = await lockedLoaderFixture();
    const foreignDiscovery = createPrismaIdentitySessionRefreshDiscovery(fixture.writer.client);
    const foreignTicket = await foundTicket(foreignDiscovery, refreshDigest(71));

    await expect(fixture.loader.loadForUpdate(fixture.scope, foreignTicket)).rejects.toBeInstanceOf(
      InvalidIdentitySessionRefreshDiscoveryTicketError,
    );
    expect(fixture.transaction.queryRaw).not.toHaveBeenCalled();

    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).resolves.toMatchObject({ kind: 'found' });
  });

  it('requires the discovery and loader to share the exact writer client', async (): Promise<void> => {
    const writer = writerFixture();
    const foreignWriter = writerFixture();
    const transaction = transactionFixture();
    const discovery = createPrismaIdentitySessionRefreshDiscovery(writer.client);
    const boundary = createIdentitySessionRefreshWorkflow();
    const context = activateIdentitySessionRefreshWorkflow(boundary.controller, DB_NOW);
    const ticket = await foundTicket(discovery, refreshDigest());

    const error = captureSynchronousError(() =>
      createPrismaIdentitySessionRefreshLockedLoader(
        foreignWriter.client,
        transaction.client,
        discovery,
        boundary.controller,
      ),
    );
    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE);
    expect(transaction.queryRaw).not.toHaveBeenCalled();

    const loader = createPrismaIdentitySessionRefreshLockedLoader(
      writer.client,
      transaction.client,
      discovery,
      boundary.controller,
    );
    await expect(loader.loadForUpdate(context.scope, ticket)).resolves.toMatchObject({
      kind: 'found',
    });
  });

  it.each([
    ['non-array Account result', 0, (): unknown => ({ rows: [accountRow()] })],
    ['sparse Account result', 0, (): unknown => new Array<UnknownRow>(1)],
    ['overflow Account result', 0, (): unknown => [accountRow(), accountRow()]],
    [
      'extra Account row field',
      0,
      (): unknown => [{ ...accountRow(), unexpected: 'provider-secret' }],
    ],
    [
      'missing Family row field',
      1,
      (): unknown => [
        Object.fromEntries(
          Object.entries(familyRow()).filter(([key]) => key !== 'session_closed_reason'),
        ),
      ],
    ],
    [
      'invalid Account lifecycle',
      0,
      (): unknown => [accountRow({ account_status: 'provider-secret' })],
    ],
    ['number Account version', 0, (): unknown => [accountRow({ account_version: 1 })]],
    ['negative Account version', 0, (): unknown => [accountRow({ account_version: -1n })]],
    [
      'overflow Account version',
      0,
      (): unknown => [accountRow({ account_version: 4_294_967_296n })],
    ],
    ['number Family version', 1, (): unknown => [familyRow({ session_version: 1 })]],
    ['negative Family version', 1, (): unknown => [familyRow({ session_version: -1n })]],
    ['overflow Family version', 1, (): unknown => [familyRow({ session_version: 4_294_967_296n })]],
    [
      'mismatched Family relationship',
      1,
      (): unknown => [familyRow({ session_account_id: OTHER_ACCOUNT_ID })],
    ],
    [
      'mismatched credential relationship',
      2,
      (): unknown => [refreshRow({ refresh_family_id: OTHER_SESSION_ID })],
    ],
    ['number credential sequence', 2, (): unknown => [refreshRow({ refresh_sequence: 1 })]],
    ['negative credential sequence', 2, (): unknown => [refreshRow({ refresh_sequence: -1n })]],
    [
      'overflow credential sequence',
      2,
      (): unknown => [refreshRow({ refresh_sequence: 4_294_967_296n })],
    ],
    ['bigint active slot', 2, (): unknown => [refreshRow({ refresh_active_slot: 1n })]],
    ['zero active slot', 2, (): unknown => [refreshRow({ refresh_active_slot: 0 })]],
    ['non-marker active slot', 2, (): unknown => [refreshRow({ refresh_active_slot: 2 })]],
    ['negative active slot', 2, (): unknown => [refreshRow({ refresh_active_slot: -1 })]],
    ['NaN active slot', 2, (): unknown => [refreshRow({ refresh_active_slot: Number.NaN })]],
    ['fractional active slot', 2, (): unknown => [refreshRow({ refresh_active_slot: 1.5 })]],
    ['text active slot', 2, (): unknown => [refreshRow({ refresh_active_slot: '1' })]],
    [
      'unconsumed credential without active slot',
      2,
      (): unknown => [refreshRow({ refresh_active_slot: null })],
    ],
    [
      'consumed credential with active slot',
      2,
      (): unknown => [
        refreshRow({
          refresh_consumed_at: ROTATED_AT,
          refresh_successor_id: SUCCESSOR_CREDENTIAL_ID,
          refresh_active_slot: 1,
        }),
      ],
    ],
  ] as const)('fails closed on %s', async (_scenario, stage, malformedResult): Promise<void> => {
    const results: unknown[] = [[accountRow()], [familyRow()], [refreshRow()]];
    results[stage] = malformedResult();
    const transaction = transactionFixture(results);
    const fixture = await lockedLoaderFixture(transaction);
    const error = await captureRejection(() =>
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    );

    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE, [
      'provider-secret',
    ]);
    if (stage === 2) {
      expectDigestWiped(transaction.queryRaw);
    }
  });

  it('rejects accessor projections without invoking or leaking them', async (): Promise<void> => {
    const providerSecret = 'hostile-locked-row-secret';
    let getterCalls = 0;
    const row = { ...accountRow() };
    Object.defineProperty(row, 'account_status', {
      configurable: true,
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error(providerSecret);
      },
    });
    const transaction = transactionFixture([[row]]);
    const fixture = await lockedLoaderFixture(transaction);
    const error = await captureRejection(() =>
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    );

    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE, [
      providerSecret,
    ]);
    expect(getterCalls).toBe(0);
  });

  it.each([
    ['Account', 0],
    ['SessionFamily', 1],
    ['RefreshCredential', 2],
  ] as const)(
    'distinguishes unavailable and unexpected %s query failures',
    async (_stageName, stage): Promise<void> => {
      for (const [providerError, ErrorType, message] of [
        [
          knownPrismaError('P1001'),
          IdentitySessionRefreshLockedLoadUnavailableError,
          UNAVAILABLE_MESSAGE,
        ],
        [
          new Error('vendor sql and digest details'),
          IdentitySessionRefreshLockedLoadPersistenceError,
          PERSISTENCE_MESSAGE,
        ],
      ] as const) {
        const transaction = queryFailureFixture(stage, providerError);
        const fixture = await lockedLoaderFixture(transaction);
        const error = await captureRejection(() =>
          fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
        );

        expectFixedError(error, ErrorType, message, [
          'database vendor details',
          'vendor sql and digest details',
        ]);
        expect(transaction.queryRaw).toHaveBeenCalledTimes(stage + 1);
        if (stage === 2) {
          expectDigestWiped(transaction.queryRaw);
        }
      }
    },
  );

  it('wipes the digest before mapping failure and makes authentic failure absorbing', async (): Promise<void> => {
    const transaction = transactionFixture([
      [accountRow()],
      [familyRow()],
      [refreshRow({ refresh_active_slot: null })],
    ]);
    const fixture = await lockedLoaderFixture(transaction);
    const error = await captureRejection(() =>
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    );

    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE);
    expectDigestWiped(transaction.queryRaw);
    expect(transaction.queryRaw).toHaveBeenCalledTimes(3);

    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(transaction.queryRaw).toHaveBeenCalledTimes(3);
  });

  it('rejects concurrent and sequential second loads before another query', async (): Promise<void> => {
    let releaseAccount: ((value: unknown) => void) | undefined;
    const pendingAccount = new Promise<unknown>((resolve): void => {
      releaseAccount = resolve;
    });
    const transaction = transactionFixture([]);
    transaction.queryRaw.mockReturnValueOnce(pendingAccount);
    transaction.queryRaw.mockResolvedValueOnce([familyRow()]);
    transaction.queryRaw.mockResolvedValueOnce([refreshRow()]);
    const fixture = await lockedLoaderFixture(transaction);
    const firstLoad = fixture.loader.loadForUpdate(fixture.scope, fixture.ticket);

    expect(transaction.queryRaw).toHaveBeenCalledTimes(1);
    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(transaction.queryRaw).toHaveBeenCalledTimes(1);

    if (releaseAccount === undefined) {
      throw new Error('Expected the Account query release handle');
    }
    releaseAccount([accountRow()]);
    await expect(firstLoad).resolves.toMatchObject({ kind: 'found' });
    expect(transaction.queryRaw).toHaveBeenCalledTimes(3);

    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(transaction.queryRaw).toHaveBeenCalledTimes(3);
  });

  it('captures the transaction query method and preserves its receiver', async (): Promise<void> => {
    const writer = writerFixture();
    const discovery = createPrismaIdentitySessionRefreshDiscovery(writer.client);
    const ticket = await foundTicket(discovery, refreshDigest());
    const boundary = createIdentitySessionRefreshWorkflow();
    const context = activateIdentitySessionRefreshWorkflow(boundary.controller, DB_NOW);
    const capturedQueryRaw = jest.fn<
      ReturnType<QueryRawOperation>,
      Parameters<QueryRawOperation>
    >();
    capturedQueryRaw
      .mockResolvedValueOnce([accountRow()])
      .mockResolvedValueOnce([familyRow()])
      .mockResolvedValueOnce([refreshRow()]);
    const transactionClient: { $queryRaw: QueryRawOperation } = {
      $queryRaw: capturedQueryRaw,
    };
    const loader = createPrismaIdentitySessionRefreshLockedLoader(
      writer.client,
      transactionClient as IdentitySessionRefreshLockedLoaderPrismaTransactionClient,
      discovery,
      boundary.controller,
    );
    transactionClient.$queryRaw = (): Promise<unknown> =>
      Promise.reject(new Error('mutated transaction query must not run'));

    await expect(loader.loadForUpdate(context.scope, ticket)).resolves.toMatchObject({
      kind: 'found',
    });
    expect(capturedQueryRaw).toHaveBeenCalledTimes(3);
    expect(capturedQueryRaw.mock.contexts).toEqual([
      transactionClient,
      transactionClient,
      transactionClient,
    ]);
  });

  it('rejects invalid transaction dependencies with one fixed error', (): void => {
    const writer = writerFixture();
    const discovery = createPrismaIdentitySessionRefreshDiscovery(writer.client);
    const boundary = createIdentitySessionRefreshWorkflow();
    const dependencySecret = 'transaction-query-getter-secret';
    const throwingClient = Object.defineProperty({}, '$queryRaw', {
      get(): never {
        throw new Error(dependencySecret);
      },
    });

    for (const invalidDependency of [null, {}, { $queryRaw: true }, throwingClient]) {
      const error = captureSynchronousError(() =>
        createPrismaIdentitySessionRefreshLockedLoader(
          writer.client,
          invalidDependency as IdentitySessionRefreshLockedLoaderPrismaTransactionClient,
          discovery,
          boundary.controller,
        ),
      );
      expectFixedError(
        error,
        IdentitySessionRefreshLockedLoadPersistenceError,
        PERSISTENCE_MESSAGE,
        [dependencySecret],
      );
    }
  });

  it('seals its runtime and remains absent from package barrels', async (): Promise<void> => {
    const fixture = await lockedLoaderFixture();
    const runtime = fixture.loader as unknown as Readonly<{ constructor: unknown }>;
    const recoveredConstructor = runtime.constructor;

    expect(Object.isFrozen(fixture.loader)).toBe(true);
    expect(Reflect.ownKeys(fixture.loader)).toEqual([]);
    expect(Object.isFrozen(Object.getPrototypeOf(fixture.loader))).toBe(true);
    expect(typeof recoveredConstructor).toBe('function');
    expect(Object.isFrozen(recoveredConstructor)).toBe(true);

    if (typeof recoveredConstructor !== 'function') {
      throw new Error('Expected the locked-loader runtime constructor');
    }

    for (const argumentsList of [[], [Object.freeze({})], [Object.freeze({}), Object.freeze({})]]) {
      const error = captureSynchronousError((): void => {
        Reflect.construct(recoveredConstructor, argumentsList);
      });
      expectFixedError(
        error,
        IdentitySessionRefreshLockedLoadPersistenceError,
        PERSISTENCE_MESSAGE,
      );
    }

    expect(identityPrismaApi).not.toHaveProperty('createPrismaIdentitySessionRefreshLockedLoader');
    for (const internalName of [
      'createPrismaIdentitySessionRefreshLockedLoader',
      'IdentitySessionRefreshLockedLoadUnavailableError',
      'IdentitySessionRefreshLockedLoadPersistenceError',
    ]) {
      expect(identityPublicApi).not.toHaveProperty(internalName);
    }
  });
});
