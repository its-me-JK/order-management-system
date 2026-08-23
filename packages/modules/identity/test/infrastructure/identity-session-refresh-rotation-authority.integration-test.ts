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
  defineMySqlTransactionStatement,
  type MySqlTransactionOutcome,
  type MySqlTransactionProgram,
  type MySqlTransactionStatement,
} from '@oms/database/mysql-transaction';
import { getPrismaClient, type PrismaClient } from '@oms/database/prisma';
import { config as loadEnvironment } from 'dotenv';

import type { IdentitySessionRefreshMySqlTransactionFailure } from '../../src/infrastructure/mysql/identity-session-refresh-mysql.contract';
import {
  IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
  type IdentitySessionRefreshRotationAuthorityMySqlResult,
  type IdentitySessionRefreshRotationAuthorityMySqlStatement,
} from '../../src/infrastructure/mysql/identity-session-refresh-rotation-authority.statement';

const REFRESH_INTEGRATION_CONFIRMATION_VARIABLE =
  'IDENTITY_REFRESH_LOCKED_LOADER_INTEGRATION_CONFIRM_DATABASE';
const REFRESH_INTEGRATION_DATABASE = 'oms_identity_refresh_locked_loader_integration';
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const TRANSACTION_TIMEOUT_MILLISECONDS = 5_000;
const INTEGRATION_TEST_TIMEOUT_MILLISECONDS = 60_000;
const ZERO_ROLE_FIXTURE_INDEX = 91;
const MIXED_ROLE_FIXTURE_INDEX = 92;
const WRONG_ACCOUNT_VERSION_FIXTURE_INDEX = 93;
const WRONG_FAMILY_VERSION_FIXTURE_INDEX = 94;
const INACTIVE_ACCOUNT_FIXTURE_INDEX = 95;
const CLOSED_FAMILY_FIXTURE_INDEX = 96;
const AUTHORITY_FIXTURE_INDEXES = Object.freeze([
  ZERO_ROLE_FIXTURE_INDEX,
  MIXED_ROLE_FIXTURE_INDEX,
  WRONG_ACCOUNT_VERSION_FIXTURE_INDEX,
  WRONG_FAMILY_VERSION_FIXTURE_INDEX,
  INACTIVE_ACCOUNT_FIXTURE_INDEX,
  CLOSED_FAMILY_FIXTURE_INDEX,
] as const);
const FAMILY_UPDATED = Object.freeze({ kind: 'changed' as const });
const FAMILY_UPDATE_MALFORMED = Object.freeze({ kind: 'malformed' as const });
const UNEXPECTED_FAMILY_UPDATE_FAILURE = Object.freeze({
  kind: 'unexpected-family-update-failure' as const,
});

type FamilyUpdateResult = typeof FAMILY_UPDATED | typeof FAMILY_UPDATE_MALFORMED;
type FamilyUpdateStatement = MySqlTransactionStatement<
  readonly [
    resultingFamilyVersion: number,
    sessionId: string,
    accountId: string,
    priorFamilyVersion: number,
  ],
  FamilyUpdateResult,
  IdentitySessionRefreshMySqlTransactionFailure
>;
type RotationAuthorityResolvedResult = Extract<
  IdentitySessionRefreshRotationAuthorityMySqlResult,
  Readonly<{ kind: 'resolved' }>
>;
type RotationAuthorityProgramStatement =
  FamilyUpdateStatement | IdentitySessionRefreshRotationAuthorityMySqlStatement;
type CreateFixtureOptions = Readonly<{
  accountStatus?: 'ACTIVE' | 'SUSPENDED';
  familyLifecycle?: 'OPEN' | 'REVOKED';
}>;
type AuthorityFixture = Readonly<{
  accountId: string;
  accountVersion: number;
  priorFamilyVersion: number;
  resultingFamilyVersion: number;
  sessionId: string;
}>;
type NegativeProjectionInput = Readonly<{
  fixture: AuthorityFixture;
  projectionAccountVersion: number;
  projectionFamilyVersion: number;
}>;
type NegativeProjectionUnexpectedCommit =
  RotationAuthorityResolvedResult | typeof UNEXPECTED_FAMILY_UPDATE_FAILURE;
type AuthorityPredicateState = Readonly<{
  account_status: string;
  account_version: bigint;
  family_closed_reason: string | null;
  family_revoked_at: string | null;
  family_version: bigint;
}>;
type IntegrationContext = Readonly<{
  client: PrismaClient;
  now: Date;
  runtime: DatabaseRuntime;
}>;

function decodeFamilyUpdate(value: unknown): FamilyUpdateResult {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return FAMILY_UPDATE_MALFORMED;
    }

    const affectedRows = Object.getOwnPropertyDescriptor(value, 'affectedRows');

    return affectedRows !== undefined &&
      Object.hasOwn(affectedRows, 'value') &&
      affectedRows.value === 1
      ? FAMILY_UPDATED
      : FAMILY_UPDATE_MALFORMED;
  } catch {
    return FAMILY_UPDATE_MALFORMED;
  }
}

const UPDATE_FAMILY_VERSION_FOR_AUTHORITY_TEST: FamilyUpdateStatement =
  defineMySqlTransactionStatement({
    text: `
      UPDATE identity_session_families AS family FORCE INDEX (PRIMARY)
      SET family.version = ?
      WHERE family.id = UUID_TO_BIN(?, 0)
        AND family.account_id = UUID_TO_BIN(?, 0)
        AND family.version = ?
    `,
    parameterCount: 4,
    decode: decodeFamilyUpdate,
  });

const ROTATION_AUTHORITY_PROGRAM_STATEMENTS = Object.freeze([
  UPDATE_FAMILY_VERSION_FOR_AUTHORITY_TEST,
  IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
] as const) satisfies readonly RotationAuthorityProgramStatement[];

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
  const confirmedDatabase = process.env[REFRESH_INTEGRATION_CONFIRMATION_VARIABLE];
  const isDedicatedTarget =
    LOOPBACK_DATABASE_HOSTS.has(options.host) &&
    !options.tls.enabled &&
    options.database === REFRESH_INTEGRATION_DATABASE;

  if (!isDedicatedTarget || confirmedDatabase !== options.database) {
    throw new Error(
      'Identity refresh rotation-authority integration tests require the dedicated loopback, ' +
        'non-TLS database and an exact confirmation variable',
    );
  }

  return options;
}

function fixtureUuid(index: number, discriminator: number): string {
  const suffix = String(index * 100 + discriminator).padStart(12, '0');

  return `01890f3a-8bcd-7def-8abc-${suffix}`;
}

function uuidBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error('Invalid rotation-authority integration UUIDv7');
  }

  const bytes = Uint8Array.from(Buffer.from(value.replaceAll('-', ''), 'hex'));

  if (bytes.byteLength !== 16) {
    throw new Error('Invalid rotation-authority integration UUID bytes');
  }

  return bytes;
}

function atOffset(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1_000);
}

async function openContext(): Promise<IntegrationContext> {
  const runtime = createDatabaseRuntime(databaseOptions());

  try {
    const client = getPrismaClient(runtime);

    await runtime.connection.probe();
    await client.$connect();
    const rows = await client.$queryRaw<readonly { db_now: Date }[]>`
      SELECT CURRENT_TIMESTAMP(6) AS db_now
    `;
    const now = rows[0]?.db_now;

    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('MySQL returned an invalid rotation-authority integration clock');
    }

    return Object.freeze({ client, now, runtime });
  } catch (error: unknown) {
    try {
      await runtime.close();
    } catch {
      // Preserve the setup failure while making shutdown best effort.
    }

    throw error;
  }
}

async function createFixture(
  context: IntegrationContext,
  index: number,
  options: CreateFixtureOptions = {},
): Promise<AuthorityFixture> {
  const accountId = fixtureUuid(index, 1);
  const sessionId = fixtureUuid(index, 2);
  const accountCreatedAt = atOffset(context.now, -90_000);
  const accountChangedAt = atOffset(context.now, -30);
  const familyCreatedAt = atOffset(context.now, -60);
  const accountStatus = options.accountStatus ?? 'ACTIVE';
  const familyLifecycle = options.familyLifecycle ?? 'OPEN';
  const accountVersion = accountStatus === 'ACTIVE' ? 1 : 2;
  const priorFamilyVersion = familyLifecycle === 'OPEN' ? 1 : 2;
  const familyRevokedAt = familyLifecycle === 'OPEN' ? null : atOffset(context.now, -10);

  await context.client.identityAccountRecord.create({
    data: {
      id: uuidBytes(accountId),
      loginName: `irra-${String(index)}`,
      status: accountStatus,
      version: accountVersion,
      createdAt: accountCreatedAt,
      updatedAt: accountStatus === 'ACTIVE' ? accountCreatedAt : accountChangedAt,
      suspendedAt: accountStatus === 'ACTIVE' ? null : accountChangedAt,
      deactivatedAt: null,
    },
  });
  await context.client.identitySessionFamilyRecord.create({
    data: {
      id: uuidBytes(sessionId),
      accountId: uuidBytes(accountId),
      version: priorFamilyVersion,
      createdAt: familyCreatedAt,
      lastRotatedAt: familyCreatedAt,
      idleExpiresAt: atOffset(context.now, 3_540),
      absoluteExpiresAt: atOffset(context.now, 86_340),
      revokedAt: familyRevokedAt,
      closedReason: familyLifecycle === 'OPEN' ? null : 'LOGOUT',
    },
  });

  return Object.freeze({
    accountId,
    accountVersion,
    priorFamilyVersion,
    resultingFamilyVersion: priorFamilyVersion + 1,
    sessionId,
  });
}

async function assignMixedAuthority(
  context: IntegrationContext,
  fixture: AuthorityFixture,
  index: number,
): Promise<void> {
  const roleIds = Object.freeze([
    fixtureUuid(index, 11),
    fixtureUuid(index, 12),
    fixtureUuid(index, 13),
  ] as const);
  const roleCreatedAt = atOffset(context.now, -1_000);
  const retiredAt = atOffset(context.now, -10);

  await context.client.identityRoleRecord.createMany({
    data: [
      {
        id: uuidBytes(roleIds[0]),
        code: `IT_ROT_AUTH_A_${String(index)}`,
        displayName: 'Integration rotation authority A',
        status: 'ACTIVE',
        version: 1,
        createdAt: roleCreatedAt,
        updatedAt: roleCreatedAt,
        retiredAt: null,
      },
      {
        id: uuidBytes(roleIds[1]),
        code: `IT_ROT_AUTH_B_${String(index)}`,
        displayName: 'Integration rotation authority B',
        status: 'ACTIVE',
        version: 1,
        createdAt: roleCreatedAt,
        updatedAt: roleCreatedAt,
        retiredAt: null,
      },
      {
        id: uuidBytes(roleIds[2]),
        code: `IT_ROT_AUTH_R_${String(index)}`,
        displayName: 'Integration retired rotation authority',
        status: 'RETIRED',
        version: 2,
        createdAt: roleCreatedAt,
        updatedAt: retiredAt,
        retiredAt,
      },
    ],
  });
  await context.client.identityRolePermissionRecord.createMany({
    data: [
      { roleId: uuidBytes(roleIds[0]), permissionCode: 'catalog.products.write' },
      { roleId: uuidBytes(roleIds[0]), permissionCode: 'catalog.products.read' },
      { roleId: uuidBytes(roleIds[1]), permissionCode: 'catalog.products.read' },
      { roleId: uuidBytes(roleIds[1]), permissionCode: 'catalog.skus.read' },
    ],
  });
  await context.client.identityAccountRoleRecord.createMany({
    data: roleIds.map((roleId) => ({
      accountId: uuidBytes(fixture.accountId),
      roleId: uuidBytes(roleId),
    })),
  });
}

function createRotationAuthorityProgram(): MySqlTransactionProgram<
  AuthorityFixture,
  RotationAuthorityResolvedResult,
  IdentitySessionRefreshMySqlTransactionFailure,
  RotationAuthorityProgramStatement
> {
  return Object.freeze({
    defectFailure: 'execution-defect' as const,
    failures: Object.freeze([
      'credential-collision',
      'conditional-conflict',
      'unavailable',
      'execution-defect',
    ] as const),
    async run(context, fixture) {
      const familyUpdate = await context.executeStatement(
        UPDATE_FAMILY_VERSION_FOR_AUTHORITY_TEST,
        Object.freeze([
          fixture.resultingFamilyVersion,
          fixture.sessionId,
          fixture.accountId,
          fixture.priorFamilyVersion,
        ] as const),
      );

      if (familyUpdate.kind !== 'changed') {
        throw new Error('Expected the transaction-local family update to change one row');
      }

      const authority = await context.executeStatement(
        IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
        Object.freeze([
          fixture.accountId,
          fixture.accountVersion,
          fixture.sessionId,
          fixture.resultingFamilyVersion,
        ] as const),
      );

      if (authority.kind !== 'resolved') {
        throw new Error('Expected transaction-local rotation authority');
      }

      return context.requestCommit(authority);
    },
    statements: ROTATION_AUTHORITY_PROGRAM_STATEMENTS,
    unavailableFailure: 'unavailable' as const,
  });
}

function createNegativeProjectionProgram(): MySqlTransactionProgram<
  NegativeProjectionInput,
  NegativeProjectionUnexpectedCommit,
  IdentitySessionRefreshMySqlTransactionFailure,
  RotationAuthorityProgramStatement
> {
  return Object.freeze({
    defectFailure: 'execution-defect' as const,
    failures: Object.freeze([
      'credential-collision',
      'conditional-conflict',
      'unavailable',
      'execution-defect',
    ] as const),
    async run(context, input) {
      const fixture = input.fixture;
      const familyUpdate = await context.executeStatement(
        UPDATE_FAMILY_VERSION_FOR_AUTHORITY_TEST,
        Object.freeze([
          fixture.resultingFamilyVersion,
          fixture.sessionId,
          fixture.accountId,
          fixture.priorFamilyVersion,
        ] as const),
      );

      if (familyUpdate.kind !== 'changed') {
        return context.requestCommit(UNEXPECTED_FAMILY_UPDATE_FAILURE);
      }

      const authority = await context.executeStatement(
        IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
        Object.freeze([
          fixture.accountId,
          input.projectionAccountVersion,
          fixture.sessionId,
          input.projectionFamilyVersion,
        ] as const),
      );

      return authority.kind === 'resolved'
        ? context.requestCommit(authority)
        : context.requestRollback('execution-defect');
    },
    statements: ROTATION_AUTHORITY_PROGRAM_STATEMENTS,
    unavailableFailure: 'unavailable' as const,
  });
}

async function executeRotationAuthority(
  context: IntegrationContext,
  fixture: AuthorityFixture,
): Promise<RotationAuthorityResolvedResult> {
  const executor = createMySqlTransactionExecutor(
    context.runtime,
    createRotationAuthorityProgram(),
    { timeoutMilliseconds: TRANSACTION_TIMEOUT_MILLISECONDS },
  );
  const outcome = await executor.execute(fixture);

  if (outcome.kind !== 'committed') {
    throw new Error(`Rotation authority transaction did not commit: ${outcome.kind}`);
  }

  const versionRows = await context.client.$queryRaw<readonly { family_version: bigint }[]>`
    SELECT version AS family_version
    FROM identity_session_families
    WHERE id = UUID_TO_BIN(${fixture.sessionId}, 0)
  `;

  assert.equal(versionRows[0]?.family_version, BigInt(fixture.resultingFamilyVersion));
  return outcome.result;
}

async function readAuthorityPredicateState(
  context: IntegrationContext,
  fixture: AuthorityFixture,
): Promise<AuthorityPredicateState> {
  const rows = await context.client.$queryRaw<readonly AuthorityPredicateState[]>`
    SELECT
      account.status AS account_status,
      account.version AS account_version,
      family.version AS family_version,
      DATE_FORMAT(family.revoked_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS family_revoked_at,
      family.closed_reason AS family_closed_reason
    FROM identity_accounts AS account
    INNER JOIN identity_session_families AS family
      ON family.account_id = account.id
    WHERE account.id = UUID_TO_BIN(${fixture.accountId}, 0)
      AND family.id = UUID_TO_BIN(${fixture.sessionId}, 0)
  `;
  const state = rows[0];

  if (state === undefined || rows.length !== 1) {
    throw new Error('Expected one rotation-authority predicate state');
  }

  return state;
}

async function assertProjectionRejectedWithoutCommit(
  context: IntegrationContext,
  input: NegativeProjectionInput,
): Promise<void> {
  const stateBefore = await readAuthorityPredicateState(context, input.fixture);
  const executor = createMySqlTransactionExecutor(
    context.runtime,
    createNegativeProjectionProgram(),
    { timeoutMilliseconds: TRANSACTION_TIMEOUT_MILLISECONDS },
  );
  const outcome: MySqlTransactionOutcome<
    NegativeProjectionUnexpectedCommit,
    IdentitySessionRefreshMySqlTransactionFailure
  > = await executor.execute(input);

  assert.deepEqual(outcome, {
    kind: 'not-committed',
    failure: 'execution-defect',
  });
  assert.deepEqual(await readAuthorityPredicateState(context, input.fixture), stateBefore);
}

async function cleanFixtures(context: IntegrationContext): Promise<void> {
  const accountIds = AUTHORITY_FIXTURE_INDEXES.map((index) => uuidBytes(fixtureUuid(index, 1)));
  const roleIds = [
    uuidBytes(fixtureUuid(MIXED_ROLE_FIXTURE_INDEX, 11)),
    uuidBytes(fixtureUuid(MIXED_ROLE_FIXTURE_INDEX, 12)),
    uuidBytes(fixtureUuid(MIXED_ROLE_FIXTURE_INDEX, 13)),
  ];

  await context.client.identityAccountRoleRecord.deleteMany({
    where: { accountId: { in: accountIds } },
  });
  await context.client.identitySessionFamilyRecord.deleteMany({
    where: { accountId: { in: accountIds } },
  });
  await context.client.identityRolePermissionRecord.deleteMany({
    where: { roleId: { in: roleIds } },
  });
  await context.client.identityRoleRecord.deleteMany({
    where: { id: { in: roleIds } },
  });
  await context.client.identityAccountRecord.deleteMany({
    where: { id: { in: accountIds } },
  });
}

void test(
  'Identity refresh rotation authority satisfies its direct real-MySQL contract',
  { timeout: INTEGRATION_TEST_TIMEOUT_MILLISECONDS },
  async (testContext) => {
    const integration = await openContext();

    try {
      await cleanFixtures(integration);
      await testContext.test(
        'reads its own family-version write and resolves zero-role authority',
        async () => {
          const fixture = await createFixture(integration, ZERO_ROLE_FIXTURE_INDEX);
          const result = await executeRotationAuthority(integration, fixture);

          assert.deepEqual(result, {
            kind: 'resolved',
            projection: {
              actorId: fixture.accountId,
              sessionId: fixture.sessionId,
              activeRoleCount: 0,
              permissions: [],
            },
          });
          assert.equal(Object.isFrozen(result), true);
          assert.equal(Object.isFrozen(result.projection), true);
          assert.equal(Object.isFrozen(result.projection.permissions), true);
        },
      );
      await testContext.test(
        'deduplicates shared permissions and excludes a retired assigned role',
        async () => {
          const fixture = await createFixture(integration, MIXED_ROLE_FIXTURE_INDEX);

          await assignMixedAuthority(integration, fixture, MIXED_ROLE_FIXTURE_INDEX);
          const result = await executeRotationAuthority(integration, fixture);

          assert.deepEqual(result, {
            kind: 'resolved',
            projection: {
              actorId: fixture.accountId,
              sessionId: fixture.sessionId,
              activeRoleCount: 2,
              permissions: ['catalog.products.read', 'catalog.products.write', 'catalog.skus.read'],
            },
          });
        },
      );
      await testContext.test('rejects a stale Account version and rolls back', async () => {
        const fixture = await createFixture(integration, WRONG_ACCOUNT_VERSION_FIXTURE_INDEX);

        await assertProjectionRejectedWithoutCommit(integration, {
          fixture,
          projectionAccountVersion: fixture.accountVersion + 1,
          projectionFamilyVersion: fixture.resultingFamilyVersion,
        });
      });
      await testContext.test(
        'rejects a stale resulting family version and rolls back',
        async () => {
          const fixture = await createFixture(integration, WRONG_FAMILY_VERSION_FIXTURE_INDEX);

          await assertProjectionRejectedWithoutCommit(integration, {
            fixture,
            projectionAccountVersion: fixture.accountVersion,
            projectionFamilyVersion: fixture.resultingFamilyVersion + 1,
          });
        },
      );
      await testContext.test('rejects an inactive Account and rolls back', async () => {
        const fixture = await createFixture(integration, INACTIVE_ACCOUNT_FIXTURE_INDEX, {
          accountStatus: 'SUSPENDED',
        });

        await assertProjectionRejectedWithoutCommit(integration, {
          fixture,
          projectionAccountVersion: fixture.accountVersion,
          projectionFamilyVersion: fixture.resultingFamilyVersion,
        });
      });
      await testContext.test('rejects a revoked and closed family and rolls back', async () => {
        const fixture = await createFixture(integration, CLOSED_FAMILY_FIXTURE_INDEX, {
          familyLifecycle: 'REVOKED',
        });

        await assertProjectionRejectedWithoutCommit(integration, {
          fixture,
          projectionAccountVersion: fixture.accountVersion,
          projectionFamilyVersion: fixture.resultingFamilyVersion,
        });
      });
    } finally {
      try {
        await cleanFixtures(integration);
      } finally {
        await integration.runtime.close();
      }
    }
  },
);
