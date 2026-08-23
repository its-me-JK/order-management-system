import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

import {
  parseDatabaseRuntimeConfiguration,
  resolveDatabaseRuntimeConfiguration,
} from '@oms/configuration';
import {
  createDatabaseRuntime,
  type DatabaseConnectionOptions,
  type DatabaseRuntime,
} from '@oms/database';
import { getPrismaClient, Prisma, type PrismaClient } from '@oms/database/prisma';
import { config as loadEnvironment } from 'dotenv';

import {
  IdentitySessionRefreshLockedLoadPersistenceError,
  IdentitySessionRefreshLockedLoadUnavailableError,
} from '../../src/application/identity-session-refresh-locked-loader';
import {
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityRefreshCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import type {
  IdentitySessionRefreshDiscovery,
  IdentitySessionRefreshDiscoveryFoundTicket,
} from '../../src/application/identity-session-refresh-discovery';
import {
  activateIdentitySessionRefreshWorkflow,
  closeIdentitySessionRefreshWorkflow,
  createIdentitySessionRefreshWorkflow,
  type IdentitySessionRefreshLockedLoadResult,
} from '../../src/application/identity-session-refresh-workflow';
import { IdentityAccount, type IdentityAccountSnapshot } from '../../src/domain/identity-account';
import {
  IdentityRefreshCredential,
  type IdentityRefreshCredentialSnapshot,
} from '../../src/domain/identity-refresh-credential';
import {
  IdentitySessionFamily,
  type IdentitySessionFamilySnapshot,
} from '../../src/domain/identity-session-family';
import { parseIdentityInstant, type IdentityInstant } from '../../src/domain/identity-values';
import { createPrismaIdentitySessionRefreshDiscovery } from '../../src/infrastructure/prisma/prisma-identity-session-refresh-discovery';
import {
  createPrismaIdentitySessionRefreshLockedLoader,
  type IdentitySessionRefreshLockedLoaderPrismaTransactionClient,
} from '../../src/infrastructure/prisma/prisma-identity-session-refresh-locked-loader';

const LOCKED_LOADER_INTEGRATION_CONFIRMATION_VARIABLE =
  'IDENTITY_REFRESH_LOCKED_LOADER_INTEGRATION_CONFIRM_DATABASE';
const LOCKED_LOADER_INTEGRATION_DATABASE = 'oms_identity_refresh_locked_loader_integration';
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const TRANSACTION_MAX_WAIT_MILLISECONDS = 2_000;
const TRANSACTION_TIMEOUT_MILLISECONDS = 5_000;
const COORDINATION_TIMEOUT_MILLISECONDS = 4_000;
const INTEGRATION_TEST_TIMEOUT_MILLISECONDS = 60_000;

type StoredRefreshCredential = Readonly<{
  digest: IdentityRefreshCredentialDigest;
  digestBytes: Uint8Array<ArrayBuffer>;
  id: string;
  snapshot: IdentityRefreshCredentialSnapshot;
}>;

type LockedLoaderFixture = Readonly<{
  account: IdentityAccountSnapshot;
  credential: StoredRefreshCredential;
  sessionFamily: IdentitySessionFamilySnapshot;
}>;

type LoadedProjection =
  | Readonly<{
      connectionId: string;
      kind: 'not-found';
    }>
  | Readonly<{
      account: IdentityAccountSnapshot;
      connectionId: string;
      kind: 'found';
      presentedRefreshCredential: IdentityRefreshCredentialSnapshot;
      sessionFamily: IdentitySessionFamilySnapshot;
    }>;

type IntegrationContext = Readonly<{
  client: PrismaClient;
  discovery: IdentitySessionRefreshDiscovery;
  fixtureNow: IdentityInstant;
  options: DatabaseConnectionOptions;
  runtime: DatabaseRuntime;
}>;

type TransactionClockRow = Readonly<{
  connection_id: bigint | number;
  db_now: string;
  time_zone: string;
  transaction_isolation: string;
}>;

type ExplainRow = Readonly<{
  key: string | null;
  table: string | null;
  type: string;
}>;

type Deferred = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}>;

type QueryRawTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

type SanitizedRawFailure = Readonly<{
  mysqlOriginalCode: number | null;
  prismaCode: string | null;
}>;

type PromiseOutcome<T> =
  Readonly<{ kind: 'fulfilled'; value: T }> | Readonly<{ error: unknown; kind: 'rejected' }>;

function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;

  while (!existsSync(resolve(currentDirectory, 'pnpm-workspace.yaml'))) {
    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error('Unable to locate the repository root');
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

const repositoryRoot = findRepositoryRoot(__dirname);

loadEnvironment({
  path: resolve(repositoryRoot, '.env'),
  quiet: true,
});

function databaseOptions(): DatabaseConnectionOptions {
  const configuration = parseDatabaseRuntimeConfiguration(process.env, 'test');
  const options = resolveDatabaseRuntimeConfiguration(configuration, {
    baseDirectory: repositoryRoot,
    readFile: (path): string => readFileSync(path, 'utf8'),
  });
  const confirmedDatabase = process.env[LOCKED_LOADER_INTEGRATION_CONFIRMATION_VARIABLE];
  const isDedicatedTarget =
    LOOPBACK_DATABASE_HOSTS.has(options.host) &&
    !options.tls.enabled &&
    options.database === LOCKED_LOADER_INTEGRATION_DATABASE;

  if (!isDedicatedTarget || confirmedDatabase !== options.database) {
    throw new Error(
      'Identity refresh locked-loader integration tests require the dedicated loopback, ' +
        'non-TLS database and an exact confirmation variable',
    );
  }

  return options;
}

function fixtureUuid(index: number, discriminator: number): string {
  const suffix = String(index * 100 + discriminator).padStart(12, '0');

  return `01890f3a-8bcd-7def-8abc-${suffix}`;
}

function digestBytes(seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_value, index): number => (seed * 37 + index * 11) % 256);
}

function withFixtureMicroseconds(value: IdentityInstant): IdentityInstant {
  return parseIdentityInstant(`${value.slice(0, 19)}.123456Z`);
}

function offsetInstant(value: IdentityInstant, seconds: number): IdentityInstant {
  const wholeSecond = new Date(`${value.slice(0, 19)}Z`);

  wholeSecond.setUTCSeconds(wholeSecond.getUTCSeconds() + seconds);

  return parseIdentityInstant(`${wholeSecond.toISOString().slice(0, 19)}${value.slice(19)}`);
}

function toMySqlDateTime6(value: IdentityInstant): string {
  return `${value.slice(0, 10)} ${value.slice(11, -1)}`;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolveDeferred): void => {
    resolvePromise = resolveDeferred;
  });

  if (resolvePromise === undefined) {
    throw new Error('Unable to create deferred integration signal');
  }

  return Object.freeze({ promise, resolve: resolvePromise });
}

async function withTimeout<T>(
  promise: Promise<T>,
  operation: string,
  timeoutMilliseconds = COORDINATION_TIMEOUT_MILLISECONDS,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject): void => {
    timeout = setTimeout((): void => {
      reject(new Error(`${operation} exceeded its integration-test deadline`));
    }, timeoutMilliseconds);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function observePromise<T>(promise: Promise<T>): Promise<PromiseOutcome<T>> {
  return promise.then(
    (value): PromiseOutcome<T> => Object.freeze({ kind: 'fulfilled', value }),
    (error: unknown): PromiseOutcome<T> => Object.freeze({ error, kind: 'rejected' }),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeRawFailure(error: unknown): SanitizedRawFailure {
  let mysqlOriginalCode: number | null = null;
  let prismaCode: string | null = null;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    prismaCode = error.code;
    const driverAdapterError = isRecord(error.meta) ? error.meta['driverAdapterError'] : undefined;
    const cause = isRecord(driverAdapterError) ? driverAdapterError['cause'] : undefined;
    const originalCode = isRecord(cause) ? cause['originalCode'] : undefined;

    if (typeof originalCode === 'string' && /^(?:0|[1-9]\d*)$/u.test(originalCode)) {
      const parsedCode = Number(originalCode);

      if (Number.isSafeInteger(parsedCode) && String(parsedCode) === originalCode) {
        mysqlOriginalCode = parsedCode;
      }
    }
  }

  return Object.freeze({ mysqlOriginalCode, prismaCode });
}

async function captureSanitizedRawFailure(
  operation: () => Promise<unknown>,
): Promise<SanitizedRawFailure> {
  try {
    await operation();
  } catch (error: unknown) {
    return sanitizeRawFailure(error);
  }

  throw new Error('Expected the static database operation to be denied');
}

function normalizeSql(strings: TemplateStringsArray): string {
  return strings.join('?').replaceAll(/\s+/gu, ' ').trim();
}

function tracedTransactionClient(
  transaction: Prisma.TransactionClient,
  statementTrace: string[] | undefined,
  rawFailureTrace: SanitizedRawFailure[] | undefined,
): IdentitySessionRefreshLockedLoaderPrismaTransactionClient {
  if (statementTrace === undefined && rawFailureTrace === undefined) {
    return transaction;
  }

  const queryRaw = transaction.$queryRaw as unknown as QueryRawTag;

  return Object.freeze({
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> {
      statementTrace?.push(normalizeSql(strings));

      try {
        return await Reflect.apply(queryRaw, transaction, [strings, ...values]);
      } catch (error: unknown) {
        rawFailureTrace?.push(sanitizeRawFailure(error));
        throw error;
      }
    },
  }) as unknown as IdentitySessionRefreshLockedLoaderPrismaTransactionClient;
}

async function openContext(): Promise<IntegrationContext> {
  const options = databaseOptions();
  const runtime = createDatabaseRuntime(options);
  const client = getPrismaClient(runtime);

  await runtime.connection.probe();
  await client.$connect();

  const clockRows = await client.$queryRaw<readonly { db_now: string }[]>`
    SELECT DATE_FORMAT(
      CURRENT_TIMESTAMP(6),
      '%Y-%m-%dT%H:%i:%s.%fZ'
    ) AS db_now
  `;
  const dbNow = clockRows[0]?.db_now;

  if (typeof dbNow !== 'string') {
    await runtime.close();
    throw new Error('MySQL returned an invalid integration clock');
  }

  return Object.freeze({
    client,
    discovery: createPrismaIdentitySessionRefreshDiscovery(client),
    fixtureNow: withFixtureMicroseconds(parseIdentityInstant(dbNow)),
    options,
    runtime,
  });
}

async function insertAccount(
  context: IntegrationContext,
  account: IdentityAccountSnapshot,
): Promise<void> {
  const affectedRows = await context.client.$executeRaw`
    INSERT INTO identity_accounts (
      id,
      login_name,
      status,
      version,
      created_at,
      updated_at,
      suspended_at,
      deactivated_at
    ) VALUES (
      UUID_TO_BIN(${account.id}, 0),
      ${account.loginName},
      ${account.status},
      ${account.version},
      CAST(${toMySqlDateTime6(account.createdAt)} AS DATETIME(6)),
      CAST(${toMySqlDateTime6(account.updatedAt)} AS DATETIME(6)),
      ${account.suspendedAt === null ? null : toMySqlDateTime6(account.suspendedAt)},
      ${account.deactivatedAt === null ? null : toMySqlDateTime6(account.deactivatedAt)}
    )
  `;

  assert.equal(affectedRows, 1);
}

async function insertSessionFamily(
  context: IntegrationContext,
  family: IdentitySessionFamilySnapshot,
): Promise<void> {
  const affectedRows = await context.client.$executeRaw`
    INSERT INTO identity_session_families (
      id,
      account_id,
      version,
      created_at,
      last_rotated_at,
      idle_expires_at,
      absolute_expires_at,
      revoked_at,
      closed_reason
    ) VALUES (
      UUID_TO_BIN(${family.id}, 0),
      UUID_TO_BIN(${family.accountId}, 0),
      ${family.version},
      CAST(${toMySqlDateTime6(family.createdAt)} AS DATETIME(6)),
      CAST(${toMySqlDateTime6(family.lastRotatedAt)} AS DATETIME(6)),
      CAST(${toMySqlDateTime6(family.refreshIdleExpiresAt)} AS DATETIME(6)),
      CAST(${toMySqlDateTime6(family.refreshAbsoluteExpiresAt)} AS DATETIME(6)),
      ${family.revokedAt === null ? null : toMySqlDateTime6(family.revokedAt)},
      ${family.closedReason}
    )
  `;

  assert.equal(affectedRows, 1);
}

async function insertRefreshCredential(
  context: IntegrationContext,
  credential: StoredRefreshCredential,
  activeSlot: 1 | null,
): Promise<void> {
  const snapshot = credential.snapshot;
  const affectedRows = await context.client.$executeRaw`
    INSERT INTO identity_refresh_credentials (
      id,
      family_id,
      digest,
      sequence,
      issued_at,
      expires_at,
      consumed_at,
      successor_id,
      active_slot
    ) VALUES (
      UUID_TO_BIN(${snapshot.id}, 0),
      UUID_TO_BIN(${snapshot.sessionId}, 0),
      ${credential.digestBytes},
      ${snapshot.sequence},
      CAST(${toMySqlDateTime6(snapshot.issuedAt)} AS DATETIME(6)),
      CAST(${toMySqlDateTime6(snapshot.expiresAt)} AS DATETIME(6)),
      ${snapshot.consumedAt === null ? null : toMySqlDateTime6(snapshot.consumedAt)},
      ${snapshot.successorId},
      ${activeSlot}
    )
  `;

  assert.equal(affectedRows, 1);
}

function storedRefreshCredential(
  snapshot: IdentityRefreshCredentialSnapshot,
  rawDigest: Uint8Array<ArrayBuffer>,
): StoredRefreshCredential {
  return Object.freeze({
    digest: createIdentityRefreshCredentialDigestFromBytes(rawDigest),
    digestBytes: rawDigest,
    id: snapshot.id,
    snapshot: Object.freeze(snapshot),
  });
}

async function createActiveFixture(
  context: IntegrationContext,
  index: number,
  existingAccount?: IdentityAccountSnapshot,
): Promise<LockedLoaderFixture> {
  const account =
    existingAccount ??
    IdentityAccount.rehydrate({
      id: fixtureUuid(index, 1),
      loginName: `irll-${String(index)}`,
      status: 'ACTIVE' as const,
      version: 1,
      createdAt: offsetInstant(context.fixtureNow, -100_000),
      updatedAt: offsetInstant(context.fixtureNow, -100_000),
      suspendedAt: null,
      deactivatedAt: null,
    }).toSnapshot();
  const familyCreatedAt = offsetInstant(context.fixtureNow, -120);
  const family = IdentitySessionFamily.rehydrate({
    id: fixtureUuid(index, 2),
    accountId: account.id,
    version: 1,
    createdAt: familyCreatedAt,
    lastRotatedAt: familyCreatedAt,
    refreshIdleExpiresAt: offsetInstant(context.fixtureNow, 3_480),
    refreshAbsoluteExpiresAt: offsetInstant(familyCreatedAt, 86_400),
    revokedAt: null,
    closedReason: null,
  }).toSnapshot();
  const credentialSnapshot = IdentityRefreshCredential.rehydrate({
    id: fixtureUuid(index, 3),
    sessionId: family.id,
    sequence: 1,
    issuedAt: familyCreatedAt,
    expiresAt: family.refreshIdleExpiresAt,
    consumedAt: null,
    successorId: null,
  }).toSnapshot();
  const credential = storedRefreshCredential(credentialSnapshot, digestBytes(index * 10 + 1));

  if (existingAccount === undefined) {
    await insertAccount(context, account);
  }

  await insertSessionFamily(context, family);
  await insertRefreshCredential(context, credential, 1);

  return Object.freeze({ account, credential, sessionFamily: family });
}

async function createRetainedLifecycleFixture(
  context: IntegrationContext,
  index: number,
): Promise<LockedLoaderFixture> {
  const accountCreatedAt = offsetInstant(context.fixtureNow, -100_000);
  const accountChangedAt = offsetInstant(context.fixtureNow, -1);
  const account = IdentityAccount.rehydrate({
    id: fixtureUuid(index, 1),
    loginName: `irll-${String(index)}`,
    status: 'SUSPENDED' as const,
    version: 2,
    createdAt: accountCreatedAt,
    updatedAt: accountChangedAt,
    suspendedAt: accountChangedAt,
    deactivatedAt: null,
  }).toSnapshot();
  const family = IdentitySessionFamily.rehydrate({
    id: fixtureUuid(index, 2),
    accountId: account.id,
    version: 3,
    createdAt: offsetInstant(context.fixtureNow, -90_000),
    lastRotatedAt: offsetInstant(context.fixtureNow, -80_000),
    refreshIdleExpiresAt: offsetInstant(context.fixtureNow, -4_000),
    refreshAbsoluteExpiresAt: offsetInstant(context.fixtureNow, -3_600),
    revokedAt: offsetInstant(context.fixtureNow, -5_000),
    closedReason: 'LOGOUT' as const,
  }).toSnapshot();
  const successorId = fixtureUuid(index, 4);
  const predecessorSnapshot = IdentityRefreshCredential.rehydrate({
    id: fixtureUuid(index, 3),
    sessionId: family.id,
    sequence: 1,
    issuedAt: family.createdAt,
    expiresAt: family.refreshAbsoluteExpiresAt,
    consumedAt: family.lastRotatedAt,
    successorId,
  }).toSnapshot();
  const successorSnapshot = IdentityRefreshCredential.rehydrate({
    id: successorId,
    sessionId: family.id,
    sequence: 2,
    issuedAt: family.lastRotatedAt,
    expiresAt: family.refreshIdleExpiresAt,
    consumedAt: null,
    successorId: null,
  }).toSnapshot();
  const predecessor = storedRefreshCredential(predecessorSnapshot, digestBytes(index * 10 + 1));
  const successor = storedRefreshCredential(successorSnapshot, digestBytes(index * 10 + 2));

  await insertAccount(context, account);
  await insertSessionFamily(context, family);
  await insertRefreshCredential(
    context,
    storedRefreshCredential(
      Object.freeze({
        ...predecessorSnapshot,
        successorId: null,
      }),
      predecessor.digestBytes,
    ),
    null,
  );
  await insertRefreshCredential(context, successor, 1);

  const linkedRows = await context.client.$executeRaw`
    UPDATE identity_refresh_credentials
    SET successor_id = UUID_TO_BIN(${successorId}, 0)
    WHERE id = UUID_TO_BIN(${predecessor.id}, 0)
  `;

  assert.equal(linkedRows, 1);

  return Object.freeze({ account, credential: predecessor, sessionFamily: family });
}

async function discoverTicket(
  context: IntegrationContext,
  credential: StoredRefreshCredential,
): Promise<IdentitySessionRefreshDiscoveryFoundTicket> {
  const result = await context.discovery.findByRefreshCredentialDigest(credential.digest);

  if (result.kind !== 'found') {
    throw new Error('Expected an authentic refresh discovery ticket');
  }

  return result;
}

async function transactionClock(
  transaction: Prisma.TransactionClient,
): Promise<Readonly<{ connectionId: string; dbNow: IdentityInstant }>> {
  const rows = await transaction.$queryRaw<readonly TransactionClockRow[]>`
    SELECT
      CONNECTION_ID() AS connection_id,
      DATE_FORMAT(
        CURRENT_TIMESTAMP(6),
        '%Y-%m-%dT%H:%i:%s.%fZ'
      ) AS db_now,
      @@SESSION.time_zone AS time_zone,
      @@SESSION.transaction_isolation AS transaction_isolation
  `;
  const row = rows[0];

  assert.ok(row);
  assert.equal(row.time_zone, '+00:00');
  assert.equal(row.transaction_isolation, 'READ-COMMITTED');

  return Object.freeze({
    connectionId: String(row.connection_id),
    dbNow: parseIdentityInstant(row.db_now),
  });
}

function projectLockedResult(
  connectionId: string,
  result: IdentitySessionRefreshLockedLoadResult,
): LoadedProjection {
  if (result.kind === 'not-found') {
    return Object.freeze({ connectionId, kind: 'not-found' as const });
  }

  return Object.freeze({
    account: result.account.toSnapshot(),
    connectionId,
    kind: 'found' as const,
    presentedRefreshCredential: result.presentedRefreshCredential.toSnapshot(),
    sessionFamily: result.sessionFamily.toSnapshot(),
  });
}

async function executeLockedLoad(
  context: IntegrationContext,
  ticket: IdentitySessionRefreshDiscoveryFoundTicket,
  hooks: Readonly<{
    afterLoad?: (projection: LoadedProjection) => Promise<void>;
    beforeLoad?: (connectionId: string) => void;
    prepareTransaction?: (transaction: Prisma.TransactionClient) => Promise<void>;
    rawFailureTrace?: SanitizedRawFailure[];
    statementTrace?: string[];
  }> = {},
): Promise<LoadedProjection> {
  return context.client.$transaction(
    async (transaction): Promise<LoadedProjection> => {
      const clock = await transactionClock(transaction);

      await hooks.prepareTransaction?.(transaction);

      const workflow = createIdentitySessionRefreshWorkflow();
      const activeContext = activateIdentitySessionRefreshWorkflow(
        workflow.controller,
        clock.dbNow,
      );
      const loader = createPrismaIdentitySessionRefreshLockedLoader(
        context.client,
        tracedTransactionClient(transaction, hooks.statementTrace, hooks.rawFailureTrace),
        context.discovery,
        workflow.controller,
      );

      try {
        hooks.beforeLoad?.(clock.connectionId);
        const result = await loader.loadForUpdate(activeContext.scope, ticket);
        const projection = projectLockedResult(clock.connectionId, result);

        await hooks.afterLoad?.(projection);

        return projection;
      } finally {
        closeIdentitySessionRefreshWorkflow(workflow.controller);
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: TRANSACTION_MAX_WAIT_MILLISECONDS,
      timeout: TRANSACTION_TIMEOUT_MILLISECONDS,
    },
  );
}

async function assertDmlOnlyApplicationGrant(context: IntegrationContext): Promise<void> {
  const grantRows = await context.client.$queryRaw<readonly Record<string, string>[]>`
    SHOW GRANTS FOR CURRENT_USER()
  `;
  const grants = grantRows.flatMap((row) => Object.values(row));
  const databaseGrantPattern = context.options.database.replaceAll('_', '\\_');
  const targetMarker = `ON \`${databaseGrantPattern}\`.`;
  const targetGrants = grants.filter((grant) => grant.includes(targetMarker));
  const globalGrants = grants.filter((grant) => grant.includes(' ON *.* TO '));

  assert.deepEqual(targetGrants, [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${databaseGrantPattern}\`.* TO \`${context.options.user}\`@\`%\``,
  ]);
  assert.deepEqual(globalGrants, [`GRANT USAGE ON *.* TO \`${context.options.user}\`@\`%\``]);

  const deniedDdlFailure = await captureSanitizedRawFailure(
    () => context.client.$executeRaw`
    CREATE TABLE identity_refresh_locked_loader_privilege_probe (
      id TINYINT UNSIGNED NOT NULL
    )
  `,
  );

  assert.deepEqual(deniedDdlFailure, {
    mysqlOriginalCode: 1142,
    prismaCode: 'P2010',
  });
}

async function assertPrimaryPlans(
  context: IntegrationContext,
  fixture: LockedLoaderFixture,
): Promise<void> {
  const accountPlan = await context.client.$queryRaw<readonly ExplainRow[]>`
    EXPLAIN
    SELECT account.id
    FROM identity_accounts AS account FORCE INDEX (PRIMARY)
    WHERE account.id = UUID_TO_BIN(${fixture.account.id}, 0)
    LIMIT ${2}
    FOR UPDATE
  `;
  const familyPlan = await context.client.$queryRaw<readonly ExplainRow[]>`
    EXPLAIN
    SELECT family.id
    FROM identity_session_families AS family FORCE INDEX (PRIMARY)
    WHERE family.id = UUID_TO_BIN(${fixture.sessionFamily.id}, 0)
      AND family.account_id = UUID_TO_BIN(${fixture.account.id}, 0)
    LIMIT ${2}
    FOR UPDATE
  `;
  const refreshPlan = await context.client.$queryRaw<readonly ExplainRow[]>`
    EXPLAIN
    SELECT refresh.id
    FROM identity_refresh_credentials AS refresh FORCE INDEX (PRIMARY)
    WHERE refresh.id = UUID_TO_BIN(${fixture.credential.id}, 0)
      AND refresh.family_id = UUID_TO_BIN(${fixture.sessionFamily.id}, 0)
      AND refresh.digest = ${fixture.credential.digestBytes}
    LIMIT ${2}
    FOR UPDATE
  `;

  for (const [alias, rows] of [
    ['account', accountPlan],
    ['family', familyPlan],
    ['refresh', refreshPlan],
  ] as const) {
    const row = rows.find((candidate) => candidate.table === alias);

    assert.equal(row?.key, 'PRIMARY');
    assert.equal(row.type, 'const');
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo | null;

  if (address === null) {
    throw new Error('Stalled Identity database test server did not bind');
  }

  return address.port;
}

async function closeServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }

  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolveClose, reject): void => {
    server.close((error): void => {
      if (error === undefined) {
        resolveClose();
      } else {
        reject(error);
      }
    });
  });
}

async function assertRealOutageIsUnavailable(
  context: IntegrationContext,
  fixture: LockedLoaderFixture,
): Promise<void> {
  const ticket = await discoverTicket(context, fixture.credential);
  const sockets = new Set<Socket>();
  const server = createServer((socket): void => {
    sockets.add(socket);
    socket.once('close', (): void => {
      sockets.delete(socket);
    });
  });
  const port = await listen(server);
  const stalledRuntime = createDatabaseRuntime({
    ...context.options,
    acquireTimeoutMilliseconds: 500,
    connectTimeoutMilliseconds: 100,
    connectionLimit: 2,
    transactionConnectionLimit: 1,
    host: '127.0.0.1',
    port,
    tls: { enabled: false },
  });
  const workflow = createIdentitySessionRefreshWorkflow();
  const activeContext = activateIdentitySessionRefreshWorkflow(
    workflow.controller,
    context.fixtureNow,
  );
  const loader = createPrismaIdentitySessionRefreshLockedLoader(
    context.client,
    getPrismaClient(stalledRuntime),
    context.discovery,
    workflow.controller,
  );

  try {
    await assert.rejects(
      loader.loadForUpdate(activeContext.scope, ticket),
      (error: unknown): boolean => {
        assert.ok(error instanceof IdentitySessionRefreshLockedLoadUnavailableError);
        assert.equal(
          error.message,
          'Identity session refresh locked load is temporarily unavailable',
        );
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  } finally {
    closeIdentitySessionRefreshWorkflow(workflow.controller);
    await closeServer(server, sockets);
    await stalledRuntime.close();
  }
}

void test(
  'Identity session refresh locked loader satisfies its real-MySQL contract',
  { timeout: INTEGRATION_TEST_TIMEOUT_MILLISECONDS },
  async (testContext) => {
    const integration = await openContext();

    try {
      await testContext.test('uses only the dedicated DML application grant', async () => {
        await assertDmlOnlyApplicationGrant(integration);
      });

      await testContext.test(
        'locks and rehydrates an active current generation without losing microseconds',
        async () => {
          const fixture = await createActiveFixture(integration, 1);
          const ticket = await discoverTicket(integration, fixture.credential);
          const statementTrace: string[] = [];
          const loaded = await executeLockedLoad(integration, ticket, {
            statementTrace,
          });

          assert.deepEqual(loaded, {
            account: fixture.account,
            connectionId: loaded.connectionId,
            kind: 'found',
            presentedRefreshCredential: fixture.credential.snapshot,
            sessionFamily: fixture.sessionFamily,
          });
          assert.match(fixture.sessionFamily.createdAt, /\.123456Z$/u);
          assert.match(fixture.credential.snapshot.expiresAt, /\.123456Z$/u);
          assert.equal(statementTrace.length, 3);
          assert.match(
            statementTrace[0] ?? '',
            /FROM identity_accounts AS account FORCE INDEX \(PRIMARY\).*FOR UPDATE/iu,
          );
          assert.match(
            statementTrace[1] ?? '',
            /FROM identity_session_families AS family FORCE INDEX \(PRIMARY\).*FOR UPDATE/iu,
          );
          assert.match(
            statementTrace[2] ?? '',
            /FROM identity_refresh_credentials AS refresh FORCE INDEX \(PRIMARY\).*refresh\.digest = \?.*FOR UPDATE/iu,
          );
        },
      );

      await testContext.test(
        'locks a consumed expired predecessor in a revoked expired inactive session',
        async () => {
          const fixture = await createRetainedLifecycleFixture(integration, 2);
          const ticket = await discoverTicket(integration, fixture.credential);
          const loaded = await executeLockedLoad(integration, ticket);

          assert.deepEqual(loaded, {
            account: fixture.account,
            connectionId: loaded.connectionId,
            kind: 'found',
            presentedRefreshCredential: fixture.credential.snapshot,
            sessionFamily: fixture.sessionFamily,
          });
        },
      );

      await testContext.test(
        'returns locked not-found when the discovered digest no longer matches the exact row',
        async () => {
          const fixture = await createActiveFixture(integration, 3);
          const ticket = await discoverTicket(integration, fixture.credential);
          const changedRows = await integration.client.$executeRaw`
            UPDATE identity_refresh_credentials
            SET digest = ${digestBytes(253)}
            WHERE id = UUID_TO_BIN(${fixture.credential.id}, 0)
          `;

          assert.equal(changedRows, 1);
          const loaded = await executeLockedLoad(integration, ticket);

          assert.equal(loaded.kind, 'not-found');
          assert.deepEqual(Object.keys(loaded).sort(), ['connectionId', 'kind']);
        },
      );

      await testContext.test('uses the primary index for every locking lookup', async () => {
        const fixture = await createActiveFixture(integration, 4);

        await assertPrimaryPlans(integration, fixture);
      });

      await testContext.test(
        'proves the shared Account is the first contended lock on distinct transactions',
        async () => {
          const firstFixture = await createActiveFixture(integration, 5);
          const secondFixture = await createActiveFixture(integration, 6, firstFixture.account);
          const firstTicket = await discoverTicket(integration, firstFixture.credential);
          const secondTicket = await discoverTicket(integration, secondFixture.credential);
          const firstLoaded = deferred();
          const releaseFirst = deferred();
          const secondStarted = deferred();
          const secondStatementTrace: string[] = [];
          const secondRawFailureTrace: SanitizedRawFailure[] = [];
          let firstConnectionId: string | undefined;
          let secondConnectionId: string | undefined;
          let secondTransactionOutcome: Promise<PromiseOutcome<LoadedProjection>> | undefined;
          let secondOutcome: PromiseOutcome<LoadedProjection> | undefined;
          let coordinationFailure: unknown;

          assert.equal(firstFixture.account.id, secondFixture.account.id);
          assert.notEqual(firstFixture.sessionFamily.id, secondFixture.sessionFamily.id);
          assert.notEqual(firstFixture.credential.id, secondFixture.credential.id);

          const firstTransactionOutcome = observePromise(
            executeLockedLoad(integration, firstTicket, {
              afterLoad: async (): Promise<void> => {
                firstLoaded.resolve();
                await withTimeout(
                  releaseFirst.promise,
                  'release of the first locked-load transaction',
                );
              },
              beforeLoad: (connectionId): void => {
                firstConnectionId = connectionId;
              },
            }),
          );

          try {
            await withTimeout(firstLoaded.promise, 'first locked load');

            secondTransactionOutcome = observePromise(
              executeLockedLoad(integration, secondTicket, {
                beforeLoad: (connectionId): void => {
                  secondConnectionId = connectionId;
                  secondStarted.resolve();
                },
                prepareTransaction: async (transaction): Promise<void> => {
                  await transaction.$executeRaw`
                    SET SESSION innodb_lock_wait_timeout = 1
                  `;
                },
                rawFailureTrace: secondRawFailureTrace,
                statementTrace: secondStatementTrace,
              }),
            );

            await withTimeout(secondStarted.promise, 'second locked-load transaction start');
            secondOutcome = await withTimeout(
              secondTransactionOutcome,
              'second Account lock timeout',
            );
          } catch (error: unknown) {
            coordinationFailure = error;
          } finally {
            releaseFirst.resolve();
          }

          const firstOutcome = await withTimeout(
            firstTransactionOutcome,
            'first locked-load transaction settlement',
          );

          if (secondTransactionOutcome !== undefined && secondOutcome === undefined) {
            secondOutcome = await withTimeout(
              secondTransactionOutcome,
              'second locked-load transaction settlement',
            );
          }

          if (coordinationFailure !== undefined) {
            if (coordinationFailure instanceof Error) {
              throw coordinationFailure;
            }

            throw new Error('Locked-load coordination failed with a non-Error value');
          }

          if (firstOutcome.kind !== 'fulfilled') {
            throw new Error('The first locked-load transaction did not complete');
          }

          if (secondOutcome === undefined) {
            throw new Error('The second locked-load transaction did not start');
          }

          if (secondOutcome.kind !== 'rejected') {
            throw new Error('The second Account lock did not time out');
          }

          assert.equal(firstOutcome.value.kind, 'found');
          assert.equal(firstOutcome.value.connectionId, firstConnectionId);
          assert.ok(secondConnectionId);
          assert.notEqual(firstConnectionId, secondConnectionId);
          assert.ok(
            secondOutcome.error instanceof IdentitySessionRefreshLockedLoadPersistenceError,
          );
          assert.equal(
            Object.getPrototypeOf(secondOutcome.error),
            IdentitySessionRefreshLockedLoadPersistenceError.prototype,
          );
          assert.equal(
            secondOutcome.error.name,
            'IdentitySessionRefreshLockedLoadPersistenceError',
          );
          assert.equal(secondOutcome.error.message, 'Identity session refresh locked load failed');
          assert.equal(Object.hasOwn(secondOutcome.error, 'cause'), false);
          assert.deepEqual(secondRawFailureTrace, [
            { mysqlOriginalCode: 1205, prismaCode: 'P2010' },
          ]);
          assert.equal(secondStatementTrace.length, 1);
          assert.match(
            secondStatementTrace[0] ?? '',
            /FROM identity_accounts AS account FORCE INDEX \(PRIMARY\).*FOR UPDATE/iu,
          );
          assert.doesNotMatch(
            secondStatementTrace[0] ?? '',
            /identity_session_families|identity_refresh_credentials/iu,
          );
        },
      );

      await testContext.test(
        'classifies a stalled loopback MySQL handshake as unavailable',
        async () => {
          const fixture = await createActiveFixture(integration, 7);

          await assertRealOutageIsUnavailable(integration, fixture);
        },
      );
    } finally {
      await integration.runtime.close();
    }
  },
);
