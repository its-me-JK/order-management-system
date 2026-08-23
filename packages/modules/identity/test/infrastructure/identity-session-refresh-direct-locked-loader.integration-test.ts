import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
import {
  createMySqlTransactionExecutor,
  type MySqlTransactionProgram,
} from '@oms/database/mysql-transaction';
import { getPrismaClient, type PrismaClient } from '@oms/database/prisma';
import { config as loadEnvironment } from 'dotenv';

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
import {
  IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS,
  type IdentitySessionRefreshLockedLoadMySqlStatement,
} from '../../src/infrastructure/mysql/identity-session-refresh-locked-load.statements';
import type { IdentitySessionRefreshMySqlTransactionFailure } from '../../src/infrastructure/mysql/identity-session-refresh-mysql.contract';
import { createMySqlIdentitySessionRefreshLockedLoader } from '../../src/infrastructure/mysql/mysql-identity-session-refresh-locked-loader';
import { createPrismaIdentitySessionRefreshDiscovery } from '../../src/infrastructure/prisma/prisma-identity-session-refresh-discovery';

const LOCKED_LOADER_INTEGRATION_CONFIRMATION_VARIABLE =
  'IDENTITY_REFRESH_LOCKED_LOADER_INTEGRATION_CONFIRM_DATABASE';
const LOCKED_LOADER_INTEGRATION_DATABASE = 'oms_identity_refresh_locked_loader_integration';
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const TRANSACTION_TIMEOUT_MILLISECONDS = 5_000;
const INTEGRATION_TEST_TIMEOUT_MILLISECONDS = 60_000;
const FIXTURE_INDEXES = Object.freeze([81, 82] as const);

type StoredRefreshCredential = Readonly<{
  digest: IdentityRefreshCredentialDigest;
  digestBytes: Uint8Array<ArrayBuffer>;
  snapshot: IdentityRefreshCredentialSnapshot;
}>;

type DirectLockedLoaderFixture = Readonly<{
  account: IdentityAccountSnapshot;
  credential: StoredRefreshCredential;
  sessionFamily: IdentitySessionFamilySnapshot;
}>;

type LoadedProjection =
  | Readonly<{
      kind: 'not-found';
      writerTime: IdentityInstant;
    }>
  | Readonly<{
      account: IdentityAccountSnapshot;
      kind: 'found';
      presentedRefreshCredential: IdentityRefreshCredentialSnapshot;
      sessionFamily: IdentitySessionFamilySnapshot;
      writerTime: IdentityInstant;
    }>;

type IntegrationContext = Readonly<{
  client: PrismaClient;
  discovery: IdentitySessionRefreshDiscovery;
  fixtureNow: IdentityInstant;
  runtime: DatabaseRuntime;
}>;

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
      'Identity refresh direct locked-loader integration tests require the dedicated loopback, ' +
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

async function openContext(): Promise<IntegrationContext> {
  const runtime = createDatabaseRuntime(databaseOptions());

  try {
    const client = getPrismaClient(runtime);

    await runtime.connection.probe();
    await client.$connect();

    const rows = await client.$queryRaw<readonly { db_now: string }[]>`
      SELECT DATE_FORMAT(
        CURRENT_TIMESTAMP(6),
        '%Y-%m-%dT%H:%i:%s.%fZ'
      ) AS db_now
    `;
    const dbNow = rows[0]?.db_now;

    if (typeof dbNow !== 'string') {
      throw new Error('MySQL returned an invalid integration clock');
    }

    return Object.freeze({
      client,
      discovery: createPrismaIdentitySessionRefreshDiscovery(client),
      fixtureNow: withFixtureMicroseconds(parseIdentityInstant(dbNow)),
      runtime,
    });
  } catch (error: unknown) {
    try {
      await runtime.close();
    } catch {
      // Preserve the setup failure while still making shutdown best effort.
    }

    throw error;
  }
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
      NULL,
      NULL
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
      NULL,
      NULL
    )
  `;

  assert.equal(affectedRows, 1);
}

async function insertRefreshCredential(
  context: IntegrationContext,
  credential: StoredRefreshCredential,
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
      NULL,
      NULL,
      1
    )
  `;

  assert.equal(affectedRows, 1);
}

async function createActiveFixture(
  context: IntegrationContext,
  index: number,
): Promise<DirectLockedLoaderFixture> {
  const accountCreatedAt = offsetInstant(context.fixtureNow, -100_000);
  const account = IdentityAccount.rehydrate({
    id: fixtureUuid(index, 1),
    loginName: `irld-${String(index)}`,
    status: 'ACTIVE' as const,
    version: 3,
    createdAt: accountCreatedAt,
    updatedAt: offsetInstant(accountCreatedAt, 10_000),
    suspendedAt: null,
    deactivatedAt: null,
  }).toSnapshot();
  const familyCreatedAt = offsetInstant(context.fixtureNow, -10_000);
  const familyLastRotatedAt = offsetInstant(context.fixtureNow, -120);
  const sessionFamily = IdentitySessionFamily.rehydrate({
    id: fixtureUuid(index, 2),
    accountId: account.id,
    version: 7,
    createdAt: familyCreatedAt,
    lastRotatedAt: familyLastRotatedAt,
    refreshIdleExpiresAt: offsetInstant(context.fixtureNow, 3_480),
    refreshAbsoluteExpiresAt: offsetInstant(familyCreatedAt, 86_400),
    revokedAt: null,
    closedReason: null,
  }).toSnapshot();
  const credentialSnapshot = IdentityRefreshCredential.rehydrate({
    id: fixtureUuid(index, 3),
    sessionId: sessionFamily.id,
    sequence: 7,
    issuedAt: familyLastRotatedAt,
    expiresAt: sessionFamily.refreshIdleExpiresAt,
    consumedAt: null,
    successorId: null,
  }).toSnapshot();
  const rawDigest = digestBytes(index);
  const credential = Object.freeze({
    digest: createIdentityRefreshCredentialDigestFromBytes(rawDigest),
    digestBytes: rawDigest,
    snapshot: credentialSnapshot,
  });

  await insertAccount(context, account);
  await insertSessionFamily(context, sessionFamily);
  await insertRefreshCredential(context, credential);

  return Object.freeze({ account, credential, sessionFamily });
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

function projectLockedResult(
  writerTime: IdentityInstant,
  result: IdentitySessionRefreshLockedLoadResult,
): LoadedProjection {
  if (result.kind === 'not-found') {
    return Object.freeze({ kind: 'not-found' as const, writerTime });
  }

  return Object.freeze({
    account: result.account.toSnapshot(),
    kind: 'found' as const,
    presentedRefreshCredential: result.presentedRefreshCredential.toSnapshot(),
    sessionFamily: result.sessionFamily.toSnapshot(),
    writerTime,
  });
}

function createDirectLockedLoadProgram(
  client: PrismaClient,
  discovery: IdentitySessionRefreshDiscovery,
): MySqlTransactionProgram<
  IdentitySessionRefreshDiscoveryFoundTicket,
  LoadedProjection,
  IdentitySessionRefreshMySqlTransactionFailure,
  IdentitySessionRefreshLockedLoadMySqlStatement
> {
  return Object.freeze({
    defectFailure: 'execution-defect' as const,
    failures: Object.freeze([
      'credential-collision',
      'conditional-conflict',
      'unavailable',
      'execution-defect',
    ] as const),
    async run(context, ticket) {
      const workflow = createIdentitySessionRefreshWorkflow();

      try {
        const transaction = activateIdentitySessionRefreshWorkflow(
          workflow.controller,
          context.writerTime,
        );
        const loader = createMySqlIdentitySessionRefreshLockedLoader(
          client,
          context,
          discovery,
          workflow.controller,
        );
        const result = await loader.loadForUpdate(transaction.scope, ticket);

        return context.requestCommit(projectLockedResult(transaction.dbNow, result));
      } finally {
        closeIdentitySessionRefreshWorkflow(workflow.controller);
      }
    },
    statements: IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS,
    unavailableFailure: 'unavailable' as const,
  });
}

async function executeDirectLockedLoad(
  context: IntegrationContext,
  ticket: IdentitySessionRefreshDiscoveryFoundTicket,
): Promise<LoadedProjection> {
  const executor = createMySqlTransactionExecutor(
    context.runtime,
    createDirectLockedLoadProgram(context.client, context.discovery),
    { timeoutMilliseconds: TRANSACTION_TIMEOUT_MILLISECONDS },
  );
  const outcome = await executor.execute(ticket);

  if (outcome.kind !== 'committed') {
    throw new Error(`Direct locked load did not commit: ${outcome.kind}`);
  }

  return outcome.result;
}

async function cleanFixtures(context: IntegrationContext): Promise<void> {
  for (const index of FIXTURE_INDEXES) {
    const familyId = fixtureUuid(index, 2);
    const accountId = fixtureUuid(index, 1);

    await context.client.$executeRaw`
      DELETE FROM identity_refresh_credentials
      WHERE family_id = UUID_TO_BIN(${familyId}, 0)
    `;
    await context.client.$executeRaw`
      DELETE FROM identity_session_families
      WHERE id = UUID_TO_BIN(${familyId}, 0)
    `;
    await context.client.$executeRaw`
      DELETE FROM identity_accounts
      WHERE id = UUID_TO_BIN(${accountId}, 0)
    `;
  }
}

void test(
  'Identity refresh direct locked loader satisfies its prepared MySQL contract',
  { timeout: INTEGRATION_TEST_TIMEOUT_MILLISECONDS },
  async (testContext) => {
    const integration = await openContext();

    try {
      await testContext.test(
        'rehydrates nontrivial integers and DATETIME(6) values on the executor-owned connection',
        async () => {
          const fixture = await createActiveFixture(integration, FIXTURE_INDEXES[0]);
          const ticket = await discoverTicket(integration, fixture.credential);
          const loaded = await executeDirectLockedLoad(integration, ticket);

          assert.deepEqual(loaded, {
            account: fixture.account,
            kind: 'found',
            presentedRefreshCredential: fixture.credential.snapshot,
            sessionFamily: fixture.sessionFamily,
            writerTime: loaded.writerTime,
          });
          assert.equal(loaded.kind, 'found');
          assert.equal(loaded.account.version, 3);
          assert.equal(loaded.sessionFamily.version, 7);
          assert.equal(loaded.presentedRefreshCredential.sequence, 7);
          assert.match(loaded.writerTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
          assert.match(loaded.account.createdAt, /\.123456Z$/u);
          assert.match(loaded.sessionFamily.lastRotatedAt, /\.123456Z$/u);
          assert.match(loaded.presentedRefreshCredential.expiresAt, /\.123456Z$/u);
        },
      );

      await testContext.test(
        'commits locked not-found after the discovered digest drifts',
        async () => {
          const fixture = await createActiveFixture(integration, FIXTURE_INDEXES[1]);
          const ticket = await discoverTicket(integration, fixture.credential);
          const changedRows = await integration.client.$executeRaw`
            UPDATE identity_refresh_credentials
            SET digest = ${digestBytes(253)}
            WHERE id = UUID_TO_BIN(${fixture.credential.snapshot.id}, 0)
          `;

          assert.equal(changedRows, 1);
          const loaded = await executeDirectLockedLoad(integration, ticket);

          assert.equal(loaded.kind, 'not-found');
          assert.deepEqual(Object.keys(loaded).sort(), ['kind', 'writerTime']);
          assert.match(loaded.writerTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
        },
      );
    } finally {
      try {
        await cleanFixtures(integration);
      } finally {
        await integration.runtime.close();
      }
    }
  },
);
