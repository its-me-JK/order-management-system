import { inspect } from 'node:util';

import * as identityPublicApi from '../../src';
import {
  IdentitySessionRefreshLockedLoadPersistenceError,
  IdentitySessionRefreshLockedLoadUnavailableError,
} from '../../src/application/identity-session-refresh-locked-loader';
import {
  copyIdentityRefreshCredentialDigestBytes,
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
import {
  decodeIdentitySessionRefreshLockedAccountMySqlRows,
  decodeIdentitySessionRefreshLockedPresentedCredentialMySqlRows,
  decodeIdentitySessionRefreshLockedSessionFamilyMySqlRows,
  decodeIdentitySessionRefreshWriterTimeMySqlRows,
  IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS,
  type IdentitySessionRefreshLockedLoadMySqlRowResult,
  type IdentitySessionRefreshLockedLoadMySqlStatement,
} from '../../src/infrastructure/mysql/identity-session-refresh-locked-load.statements';
import {
  createMySqlIdentitySessionRefreshLockedLoader,
  type IdentitySessionRefreshLockedLoadMySqlContext,
} from '../../src/infrastructure/mysql/mysql-identity-session-refresh-locked-loader';
import * as identityPrismaApi from '../../src/infrastructure/prisma';
import {
  createPrismaIdentitySessionRefreshDiscovery,
  type IdentitySessionRefreshDiscoveryPrismaClient,
} from '../../src/infrastructure/prisma/prisma-identity-session-refresh-discovery';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const OTHER_SESSION_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const ACCOUNT_CREATED_AT = '2026-08-23T09:00:00.000001Z';
const FAMILY_CREATED_AT = '2026-08-23T10:00:00.000001Z';
const IDLE_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const DB_NOW = '2026-08-23T10:06:00.000003Z';
const PERSISTENCE_MESSAGE = 'Identity session refresh locked load failed';
const UNAVAILABLE_MESSAGE = 'Identity session refresh locked load is temporarily unavailable';

type ErrorClass = abstract new (...arguments_: never[]) => Error;
type UnknownRow = Readonly<Record<string, unknown>>;
type QueryRawOperation = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
type StageResponse =
  | Readonly<{ kind: 'raw'; value: unknown }>
  | Readonly<{ error: Error; kind: 'throw' }>
  | Readonly<{ kind: 'deferred'; promise: Promise<unknown> }>;
type StatementCall = Readonly<{
  observedParameters: readonly unknown[];
  parameters: readonly unknown[];
  statement: IdentitySessionRefreshLockedLoadMySqlStatement;
}>;
type WriterFixture = Readonly<{
  client: IdentitySessionRefreshDiscoveryPrismaClient;
  queryRaw: jest.MockedFunction<QueryRawOperation>;
}>;
type ContextFixture = Readonly<{
  calls: StatementCall[];
  context: IdentitySessionRefreshLockedLoadMySqlContext;
  executeStatement: jest.MockedFunction<
    (
      statement: IdentitySessionRefreshLockedLoadMySqlStatement,
      parameters: readonly unknown[],
    ) => Promise<IdentitySessionRefreshLockedLoadMySqlRowResult>
  >;
}>;
type LoaderFixture = Readonly<{
  boundary: IdentitySessionRefreshWorkflowBoundary;
  context: ContextFixture;
  digest: IdentityRefreshCredentialDigest;
  discovery: IdentitySessionRefreshDiscovery;
  loader: ReturnType<typeof createMySqlIdentitySessionRefreshLockedLoader>;
  scope: ReturnType<typeof activateIdentitySessionRefreshWorkflow>['scope'];
  ticket: IdentitySessionRefreshDiscoveryFoundTicket;
  writer: WriterFixture;
}>;
type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
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
    account_version: 1,
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
    session_version: 1,
    session_created_at: FAMILY_CREATED_AT,
    session_last_rotated_at: FAMILY_CREATED_AT,
    session_idle_expires_at: IDLE_EXPIRES_AT,
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
    refresh_sequence: 1,
    refresh_issued_at: FAMILY_CREATED_AT,
    refresh_expires_at: IDLE_EXPIRES_AT,
    refresh_consumed_at: null,
    refresh_successor_id: null,
    refresh_active_slot: 1,
    ...overrides,
  };
}

function writerTimeRow(overrides: Readonly<Record<string, unknown>> = {}): UnknownRow {
  return { writer_time: DB_NOW, ...overrides };
}

function withMariaDbMeta<Row>(rows: Row[]): Row[] {
  Object.defineProperty(rows, 'meta', {
    configurable: false,
    enumerable: false,
    value: Object.freeze([]),
    writable: true,
  });

  return rows;
}

function raw(value: unknown): StageResponse {
  return Object.freeze({ kind: 'raw', value });
}

function thrown(error: Error): StageResponse {
  return Object.freeze({ error, kind: 'throw' });
}

function pending(promise: Promise<unknown>): StageResponse {
  return Object.freeze({ kind: 'deferred', promise });
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve): void => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value): void {
      resolvePromise?.(value);
    },
  };
}

function defaultResponses(): readonly StageResponse[] {
  return [
    raw(withMariaDbMeta([accountRow()])),
    raw(withMariaDbMeta([familyRow()])),
    raw(withMariaDbMeta([refreshRow()])),
    raw(withMariaDbMeta([writerTimeRow()])),
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

function observedParameters(parameters: readonly unknown[]): readonly unknown[] {
  return parameters.map((parameter): unknown =>
    parameter instanceof Uint8Array ? Uint8Array.from(parameter) : parameter,
  );
}

function decodeStatementResult(
  statement: IdentitySessionRefreshLockedLoadMySqlStatement,
  value: unknown,
): IdentitySessionRefreshLockedLoadMySqlRowResult {
  if (statement === IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS[0]) {
    return decodeIdentitySessionRefreshLockedAccountMySqlRows.call(undefined, value);
  }
  if (statement === IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS[1]) {
    return decodeIdentitySessionRefreshLockedSessionFamilyMySqlRows.call(undefined, value);
  }
  if (statement === IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS[2]) {
    return decodeIdentitySessionRefreshLockedPresentedCredentialMySqlRows.call(undefined, value);
  }
  if (statement === IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS[3]) {
    return decodeIdentitySessionRefreshWriterTimeMySqlRows.call(undefined, value);
  }

  throw new Error('Unexpected direct locked-loader statement identity');
}

function contextFixture(responses: readonly StageResponse[] = defaultResponses()): ContextFixture {
  const calls: StatementCall[] = [];
  let responseIndex = 0;
  const executeStatement = jest.fn<
    Promise<IdentitySessionRefreshLockedLoadMySqlRowResult>,
    [IdentitySessionRefreshLockedLoadMySqlStatement, readonly unknown[]]
  >((statement, parameters): Promise<IdentitySessionRefreshLockedLoadMySqlRowResult> => {
    calls.push({
      observedParameters: observedParameters(parameters),
      parameters,
      statement,
    });
    const response = responses[responseIndex];
    responseIndex += 1;

    if (response === undefined) {
      return Promise.reject(new Error('Missing direct locked-loader test response'));
    }
    if (response.kind === 'throw') return Promise.reject(response.error);
    if (response.kind === 'deferred') {
      return response.promise.then((value) => decodeStatementResult(statement, value));
    }

    return Promise.resolve(decodeStatementResult(statement, response.value));
  });

  return {
    calls,
    context: Object.freeze({
      executeStatement:
        executeStatement as unknown as IdentitySessionRefreshLockedLoadMySqlContext['executeStatement'],
    }),
    executeStatement,
  };
}

async function foundTicket(
  discovery: IdentitySessionRefreshDiscovery,
  digest: IdentityRefreshCredentialDigest,
): Promise<IdentitySessionRefreshDiscoveryFoundTicket> {
  const result = await discovery.findByRefreshCredentialDigest(digest);

  if (result.kind !== 'found') throw new Error('Expected a found refresh-discovery ticket');
  return result;
}

async function loaderFixture(
  context = contextFixture(),
  writer = writerFixture(),
): Promise<LoaderFixture> {
  const digest = refreshDigest();
  const discovery = createPrismaIdentitySessionRefreshDiscovery(writer.client);
  const ticket = await foundTicket(discovery, digest);
  const boundary = createIdentitySessionRefreshWorkflow();
  const activated = activateIdentitySessionRefreshWorkflow(boundary.controller);
  const loader = createMySqlIdentitySessionRefreshLockedLoader(
    writer.client,
    context.context,
    discovery,
    boundary.controller,
  );

  return {
    boundary,
    context,
    digest,
    discovery,
    loader,
    scope: activated.scope,
    ticket,
    writer,
  };
}

async function captureRejection(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
  }

  throw new Error('Expected the operation to reject with an Error');
}

function captureSynchronousError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
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

  const rendered = inspect(error, { showHidden: true });
  for (const value of forbidden) expect(rendered).not.toContain(value);
}

async function flushUntil(predicate: () => boolean, message: string): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }

  throw new Error(message);
}

describe('direct MySQL Identity session refresh locked loader', (): void => {
  it('executes the fixed Account -> SessionFamily -> exact credential lock order and rehydrates', async (): Promise<void> => {
    const fixture = await loaderFixture();
    const expectedDigest = digestBytes();
    const digestBefore = copyIdentityRefreshCredentialDigestBytes(fixture.digest);
    const result = await fixture.loader.loadForUpdate(fixture.scope, fixture.ticket);
    const digestAfter = copyIdentityRefreshCredentialDigestBytes(fixture.digest);

    expect(result.kind).toBe('found');
    expect(Object.isFrozen(result)).toBe(true);
    expect(fixture.context.calls.map(({ statement }) => statement)).toEqual(
      IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS,
    );
    expect(fixture.context.calls).toHaveLength(4);
    expect(fixture.context.calls[0]?.parameters).toEqual([ACCOUNT_ID]);
    expect(fixture.context.calls[1]?.parameters).toEqual([SESSION_ID, ACCOUNT_ID]);
    expect(fixture.context.calls[2]?.observedParameters).toEqual([
      CREDENTIAL_ID,
      SESSION_ID,
      expectedDigest,
    ]);
    expect(fixture.context.calls[2]?.parameters.slice(0, 2)).toEqual([CREDENTIAL_ID, SESSION_ID]);
    expect(fixture.context.calls[3]?.parameters).toEqual([]);

    const boundDigest = fixture.context.calls[2]?.parameters[2];
    expect(boundDigest).toBeInstanceOf(Uint8Array);
    expect([...(boundDigest as Uint8Array)]).toEqual(Array.from({ length: 32 }, () => 0));
    expect(digestAfter).toEqual(digestBefore);
    expect(digestAfter).toEqual(expectedDigest);
    digestBefore.fill(0);
    digestAfter.fill(0);

    if (result.kind !== 'found') throw new Error('Expected a found locked load');
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
      refreshIdleExpiresAt: IDLE_EXPIRES_AT,
      refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
      revokedAt: null,
      closedReason: null,
    });
    expect(result.presentedRefreshCredential.toSnapshot()).toEqual({
      id: CREDENTIAL_ID,
      sessionId: SESSION_ID,
      sequence: 1,
      issuedAt: FAMILY_CREATED_AT,
      expiresAt: IDLE_EXPIRES_AT,
      consumedAt: null,
      successorId: null,
    });
  });

  it('keeps its digest copy live only while the credential statement is pending', async (): Promise<void> => {
    const credentialRows = deferred<unknown>();
    const context = contextFixture([
      raw(withMariaDbMeta([accountRow()])),
      raw(withMariaDbMeta([familyRow()])),
      pending(credentialRows.promise),
      raw(withMariaDbMeta([writerTimeRow()])),
    ]);
    const fixture = await loaderFixture(context);
    const expectedDigest = digestBytes();
    const load = fixture.loader.loadForUpdate(fixture.scope, fixture.ticket);

    await flushUntil(
      () => context.executeStatement.mock.calls.length === 3,
      'Credential statement was not started',
    );
    const boundDigest = context.calls[2]?.parameters[2];
    const callerDuringLoad = copyIdentityRefreshCredentialDigestBytes(fixture.digest);

    expect(boundDigest).toBeInstanceOf(Uint8Array);
    expect([...(boundDigest as Uint8Array)]).toEqual([...expectedDigest]);
    expect(callerDuringLoad).toEqual(expectedDigest);
    credentialRows.resolve(withMariaDbMeta([refreshRow()]));

    await expect(load).resolves.toMatchObject({ kind: 'found' });
    expect([...(boundDigest as Uint8Array)]).toEqual(Array.from({ length: 32 }, () => 0));
    const callerAfterLoad = copyIdentityRefreshCredentialDigestBytes(fixture.digest);
    expect(callerAfterLoad).toEqual(expectedDigest);
    callerDuringLoad.fill(0);
    callerAfterLoad.fill(0);
  });

  it.each([0, 1, 2] as const)(
    'short-circuits with authentic not-found at lock stage %i',
    async (emptyStage): Promise<void> => {
      const responses = [...defaultResponses().slice(0, emptyStage + 1)];
      responses[emptyStage] = raw(withMariaDbMeta([]));
      responses.push(raw(withMariaDbMeta([writerTimeRow()])));
      const context = contextFixture(responses);
      const fixture = await loaderFixture(context);

      await expect(fixture.loader.loadForUpdate(fixture.scope, fixture.ticket)).resolves.toEqual({
        kind: 'not-found',
      });
      expect(context.executeStatement).toHaveBeenCalledTimes(emptyStage + 2);
      expect(context.calls.map(({ statement }) => statement)).toEqual([
        ...IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS.slice(0, emptyStage + 1),
        IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS[3],
      ]);
      if (emptyStage === 2) {
        expect([...(context.calls[2]?.parameters[2] as Uint8Array)]).toEqual(
          Array.from({ length: 32 }, () => 0),
        );
      }
    },
  );

  it('accepts the MariaDB non-enumerable meta envelope without reading its value', async (): Promise<void> => {
    const providerSecret = 'metadata-value-must-stay-opaque';
    const metaValue = new Proxy(Object.freeze({}), {
      get(): never {
        throw new Error(providerSecret);
      },
    });
    const rows = [accountRow()];
    Object.defineProperty(rows, 'meta', {
      configurable: false,
      enumerable: false,
      value: metaValue,
      writable: true,
    });
    const fixture = await loaderFixture(
      contextFixture([raw(rows), ...defaultResponses().slice(1)]),
    );

    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).resolves.toMatchObject({
      kind: 'found',
    });
    expect(Object.keys(rows)).toEqual(['0']);
    expect(Reflect.ownKeys(rows)).toEqual(['0', 'length', 'meta']);
  });

  it.each([
    ['non-array envelope', (): unknown => ({ rows: [accountRow()] })],
    ['missing meta', (): unknown => [accountRow()]],
    [
      'configurable meta',
      (): unknown => {
        const rows = [accountRow()];
        Object.defineProperty(rows, 'meta', {
          configurable: true,
          enumerable: false,
          value: [],
          writable: true,
        });
        return rows;
      },
    ],
    [
      'meta accessor',
      (): unknown =>
        Object.defineProperty([accountRow()], 'meta', {
          configurable: false,
          enumerable: false,
          get: (): never => {
            throw new Error('hostile-meta-secret');
          },
        }),
    ],
    ['sparse result', (): unknown => withMariaDbMeta(new Array<UnknownRow>(1))],
    ['overflow result', (): unknown => withMariaDbMeta([accountRow(), accountRow()])],
    [
      'symbol-bearing result',
      (): unknown => {
        const rows = withMariaDbMeta([accountRow()]);
        Object.defineProperty(rows, Symbol('provider-secret'), { value: true });
        return rows;
      },
    ],
    ['array proxy', (): unknown => new Proxy(withMariaDbMeta([accountRow()]), {})],
    ['non-plain row', (): unknown => withMariaDbMeta([Object.create(accountRow())])],
    [
      'extra row field',
      (): unknown => withMariaDbMeta([{ ...accountRow(), provider_secret: true }]),
    ],
    [
      'symbol-bearing row',
      (): unknown => {
        const row = { ...accountRow() };
        Object.defineProperty(row, Symbol('provider-secret'), { value: true });
        return withMariaDbMeta([row]);
      },
    ],
  ] as const)('fails closed on a %s', async (_scenario, malformedRows): Promise<void> => {
    const context = contextFixture([raw(malformedRows()), ...defaultResponses().slice(1)]);
    const fixture = await loaderFixture(context);
    const error = await captureRejection(() =>
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    );

    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE, [
      'provider-secret',
      'hostile-meta-secret',
    ]);
    expect(context.executeStatement).toHaveBeenCalledTimes(1);
  });

  it('classifies a malformed credential envelope as persistence failure after wiping its digest copy', async (): Promise<void> => {
    const responses = [...defaultResponses()];
    responses[2] = raw([refreshRow()]);
    const context = contextFixture(responses);
    const fixture = await loaderFixture(context);
    const error = await captureRejection(() =>
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    );

    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE);
    expect(context.executeStatement).toHaveBeenCalledTimes(3);
    expect([...(context.calls[2]?.parameters[2] as Uint8Array)]).toEqual(
      Array.from({ length: 32 }, () => 0),
    );
    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(context.executeStatement).toHaveBeenCalledTimes(3);
  });

  it('rejects row accessors without invoking or leaking them', async (): Promise<void> => {
    const providerSecret = 'hostile-account-row-secret';
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
    const context = contextFixture([raw(withMariaDbMeta([row]))]);
    const fixture = await loaderFixture(context);
    const error = await captureRejection(() =>
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    );

    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE, [
      providerSecret,
    ]);
    expect(getterCalls).toBe(0);
  });

  it.each([
    ['invalid Account lifecycle', 0, 1, (): unknown => accountRow({ account_status: 'secret' })],
    ['negative Account version', 0, 1, (): unknown => accountRow({ account_version: -1 })],
    ['fractional Account version', 0, 1, (): unknown => accountRow({ account_version: 1.5 })],
    [
      'mismatched Family relationship',
      1,
      4,
      (): unknown => familyRow({ session_account_id: OTHER_ACCOUNT_ID }),
    ],
    [
      'mismatched credential relationship',
      2,
      4,
      (): unknown => refreshRow({ refresh_family_id: OTHER_SESSION_ID }),
    ],
    ['invalid credential sequence', 2, 3, (): unknown => refreshRow({ refresh_sequence: 0 })],
    [
      'unconsumed credential without active slot',
      2,
      3,
      (): unknown => refreshRow({ refresh_active_slot: null }),
    ],
    [
      'invalid post-lock writer time',
      3,
      4,
      (): unknown => writerTimeRow({ writer_time: 'writer-time-secret' }),
    ],
  ] as const)(
    'fails closed during mapping or rehydration for %s',
    async (_scenario, stage, expectedCalls, malformedRow): Promise<void> => {
      const responses = [...defaultResponses()];
      responses[stage] = raw(withMariaDbMeta([malformedRow()]));
      const context = contextFixture(responses);
      const fixture = await loaderFixture(context);
      const error = await captureRejection(() =>
        fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
      );

      expectFixedError(
        error,
        IdentitySessionRefreshLockedLoadPersistenceError,
        PERSISTENCE_MESSAGE,
        ['secret'],
      );
      expect(context.executeStatement).toHaveBeenCalledTimes(expectedCalls);
      if (stage === 2) {
        expect([...(context.calls[2]?.parameters[2] as Uint8Array)]).toEqual(
          Array.from({ length: 32 }, () => 0),
        );
      }
    },
  );

  it.each([0, 1, 2, 3] as const)(
    'fails the workflow and hides an escaped statement failure at stage %i',
    async (failureStage): Promise<void> => {
      const providerSecret = 'vendor SQL and credential details';
      const responses = [...defaultResponses()];
      responses[failureStage] = thrown(new Error(providerSecret));
      const context = contextFixture(responses);
      const fixture = await loaderFixture(context);
      const error = await captureRejection(() =>
        fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
      );

      expectFixedError(
        error,
        IdentitySessionRefreshLockedLoadUnavailableError,
        UNAVAILABLE_MESSAGE,
        [providerSecret],
      );
      expect(context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);
      if (failureStage >= 2) {
        expect([...(context.calls[2]?.parameters[2] as Uint8Array)]).toEqual(
          Array.from({ length: 32 }, () => 0),
        );
      }
      await expect(
        fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
      ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
      expect(context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);
    },
  );

  it('pairs the loader to the discovery exact writer client before statement execution', (): void => {
    const writer = writerFixture();
    const foreignWriter = writerFixture();
    const discovery = createPrismaIdentitySessionRefreshDiscovery(writer.client);
    const boundary = createIdentitySessionRefreshWorkflow();
    const context = contextFixture();
    const error = captureSynchronousError(() =>
      createMySqlIdentitySessionRefreshLockedLoader(
        foreignWriter.client,
        context.context,
        discovery,
        boundary.controller,
      ),
    );

    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE);
    expect(context.executeStatement).not.toHaveBeenCalled();
  });

  it('authenticates workflow scope and ticket identity before statements, then rejects replay', async (): Promise<void> => {
    const fixture = await loaderFixture();
    const foreignBoundary = createIdentitySessionRefreshWorkflow();
    const foreignContext = activateIdentitySessionRefreshWorkflow(foreignBoundary.controller);
    const foreignDiscovery = createPrismaIdentitySessionRefreshDiscovery(fixture.writer.client);
    const foreignTicket = await foundTicket(foreignDiscovery, refreshDigest(71));

    await expect(
      fixture.loader.loadForUpdate(foreignContext.scope, fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      fixture.loader.loadForUpdate(structuredClone(fixture.scope), fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      fixture.loader.loadForUpdate(fixture.scope, structuredClone(fixture.ticket)),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshDiscoveryTicketError);
    await expect(fixture.loader.loadForUpdate(fixture.scope, foreignTicket)).rejects.toBeInstanceOf(
      InvalidIdentitySessionRefreshDiscoveryTicketError,
    );
    expect(fixture.context.executeStatement).not.toHaveBeenCalled();

    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).resolves.toMatchObject({ kind: 'found' });
    await expect(
      fixture.loader.loadForUpdate(fixture.scope, fixture.ticket),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(fixture.context.executeStatement).toHaveBeenCalledTimes(4);
  });

  it('seals the private runtime and keeps it and statement identities out of package barrels', async (): Promise<void> => {
    const fixture = await loaderFixture();
    const runtime = fixture.loader as unknown as Readonly<{ constructor: unknown }>;
    const recoveredConstructor = runtime.constructor;

    expect(Object.isFrozen(fixture.loader)).toBe(true);
    expect(Reflect.ownKeys(fixture.loader)).toEqual([]);
    expect(Object.isFrozen(Object.getPrototypeOf(fixture.loader))).toBe(true);
    expect(typeof recoveredConstructor).toBe('function');
    expect(Object.isFrozen(recoveredConstructor)).toBe(true);
    expect(Object.isFrozen(IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS)).toBe(true);
    expect(new Set(IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS).size).toBe(4);
    for (const statement of IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS) {
      expect(Object.isFrozen(statement)).toBe(true);
      expect(Reflect.ownKeys(statement)).toEqual([]);
    }

    if (typeof recoveredConstructor !== 'function') {
      throw new Error('Expected the direct locked-loader runtime constructor');
    }
    const error = captureSynchronousError(() => Reflect.construct(recoveredConstructor, []));
    expectFixedError(error, IdentitySessionRefreshLockedLoadPersistenceError, PERSISTENCE_MESSAGE);

    for (const internalName of [
      'createMySqlIdentitySessionRefreshLockedLoader',
      'IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS',
    ]) {
      expect(identityPublicApi).not.toHaveProperty(internalName);
      expect(identityPrismaApi).not.toHaveProperty(internalName);
    }
  });
});
