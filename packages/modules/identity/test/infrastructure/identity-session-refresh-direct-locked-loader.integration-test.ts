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
  type MySqlTransactionOutcome,
  type MySqlTransactionProgram,
} from '@oms/database/mysql-transaction';
import { getPrismaClient, type PrismaClient } from '@oms/database/prisma';
import { config as loadEnvironment } from 'dotenv';

import {
  createIdentitySessionCredentialAttempt,
  type IdentitySessionCredentialAttempt,
} from '../../src/application/identity-session-credential-attempt';
import {
  createIdentitySessionCredentialCandidates,
  type IdentitySessionCredentialCandidates,
} from '../../src/application/identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from '../../src/application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import {
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
} from '../../src/application/identity-session-credential-wire.values';
import type {
  IdentitySessionRefreshDiscovery,
  IdentitySessionRefreshDiscoveryFoundTicket,
} from '../../src/application/identity-session-refresh-discovery';
import {
  parseIdentitySecurityEventId,
  type IdentitySecurityEventId,
} from '../../src/application/identity-security-event.values';
import {
  activateIdentitySessionRefreshWorkflow,
  closeIdentitySessionRefreshWorkflow,
  createIdentitySessionRefreshAttemptBoundWorkflow,
  createIdentitySessionRefreshWorkflow,
  decideIdentitySessionRefresh,
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
import {
  IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS,
  type IdentitySessionRefreshReuseDetectedMySqlStatement,
} from '../../src/infrastructure/mysql/identity-session-refresh-reuse-detected.statements';
import { createMySqlIdentitySessionRefreshLockedLoader } from '../../src/infrastructure/mysql/mysql-identity-session-refresh-locked-loader';
import {
  createMySqlIdentitySessionRefreshReuseDetectedWriter,
  isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict,
} from '../../src/infrastructure/mysql/mysql-identity-session-refresh-reuse-detected.writer';
import { createPrismaIdentitySessionRefreshDiscovery } from '../../src/infrastructure/prisma/prisma-identity-session-refresh-discovery';

const LOCKED_LOADER_INTEGRATION_CONFIRMATION_VARIABLE =
  'IDENTITY_REFRESH_LOCKED_LOADER_INTEGRATION_CONFIRM_DATABASE';
const LOCKED_LOADER_INTEGRATION_DATABASE = 'oms_identity_refresh_locked_loader_integration';
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const TRANSACTION_TIMEOUT_MILLISECONDS = 5_000;
const INTEGRATION_TEST_TIMEOUT_MILLISECONDS = 60_000;
const FIXTURE_INDEXES = Object.freeze([81, 82, 83, 84] as const);
const ACCESS_WIRE_VALUE = parseIdentityAccessCredentialWireValue(`oms_at_v1_${'A'.repeat(42)}E`);
const REFRESH_WIRE_VALUE = parseIdentityRefreshCredentialWireValue(`oms_rt_v1_${'E'.repeat(42)}M`);

type StoredRefreshCredential = Readonly<{
  digest: IdentityRefreshCredentialDigest;
  digestBytes: Uint8Array<ArrayBuffer>;
  snapshot: IdentityRefreshCredentialSnapshot;
}>;

type StoredAccessCredential = Readonly<{
  digest: IdentityAccessCredentialDigest;
  digestBytes: Uint8Array<ArrayBuffer>;
  expiresAt: IdentityInstant;
  id: string;
  issuedAt: IdentityInstant;
  sequence: number;
  sessionId: string;
}>;

type DirectLockedLoaderFixture = Readonly<{
  account: IdentityAccountSnapshot;
  credential: StoredRefreshCredential;
  sessionFamily: IdentitySessionFamilySnapshot;
}>;

type ReuseDetectedFixture = Readonly<{
  accessCredential: StoredAccessCredential;
  account: IdentityAccountSnapshot;
  decisionAccessCredentialId: string;
  decisionSuccessorCredentialId: string;
  eventId: IdentitySecurityEventId;
  presentedCredential: StoredRefreshCredential;
  sessionFamily: IdentitySessionFamilySnapshot;
  successorCredential: StoredRefreshCredential;
}>;

type CredentialPersistenceState = Readonly<{
  access: readonly AccessCredentialPersistenceRow[];
  refresh: readonly RefreshCredentialPersistenceRow[];
}>;

type AccessCredentialPersistenceRow = Readonly<{
  credential_id: string;
  digest_hex: string;
  expires_at: string;
  issued_at: string;
  sequence: bigint;
  session_id: string;
}>;

type RefreshCredentialPersistenceRow = Readonly<{
  active_slot: number | null;
  consumed_at: string | null;
  credential_id: string;
  digest_hex: string;
  expires_at: string;
  issued_at: string;
  sequence: bigint;
  session_id: string;
  successor_id: string | null;
}>;

type SessionFamilyPersistenceRow = Readonly<{
  closed_reason: string | null;
  last_rotated_at: string;
  revoked_at: string | null;
  session_id: string;
  version: bigint;
}>;

type SecurityEventPersistenceRow = Readonly<{
  actor_account_id: string | null;
  correlation_id: string | null;
  event_id: string;
  event_type: string;
  occurred_at: string;
  operator_reference: string | null;
  outcome: string;
  permission_code: string | null;
  reason_code: string | null;
  request_id: string | null;
  role_id: string | null;
  session_id: string | null;
  subject_account_id: string | null;
}>;

type ReuseDetectedProgramInput = Readonly<{
  accessCredentialId: string;
  attempt: IdentitySessionCredentialAttempt;
  eventId: IdentitySecurityEventId;
  successorRefreshCredentialId: string;
  ticket: IdentitySessionRefreshDiscoveryFoundTicket;
}>;

type ReuseDetectedProgramCommit = Readonly<{
  kind: 'reuse-detected';
  writerTime: IdentityInstant;
}>;

type ReuseDetectedProgramStatement =
  | IdentitySessionRefreshLockedLoadMySqlStatement
  | IdentitySessionRefreshReuseDetectedMySqlStatement;

const IDENTITY_SESSION_REFRESH_REUSE_PROGRAM_MYSQL_STATEMENTS = Object.freeze([
  ...IDENTITY_SESSION_REFRESH_LOCKED_LOAD_MYSQL_STATEMENTS,
  ...IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS,
] as const) satisfies readonly ReuseDetectedProgramStatement[];

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

async function insertConsumedRefreshCredentialWithoutSuccessor(
  context: IntegrationContext,
  credential: StoredRefreshCredential,
): Promise<void> {
  const snapshot = credential.snapshot;

  if (snapshot.consumedAt === null || snapshot.successorId === null) {
    throw new Error('Expected a consumed refresh credential fixture');
  }

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
      CAST(${toMySqlDateTime6(snapshot.consumedAt)} AS DATETIME(6)),
      NULL,
      NULL
    )
  `;

  assert.equal(affectedRows, 1);
}

async function linkRefreshCredentialSuccessor(
  context: IntegrationContext,
  predecessor: StoredRefreshCredential,
): Promise<void> {
  const successorId = predecessor.snapshot.successorId;

  if (successorId === null) {
    throw new Error('Expected a refresh successor fixture');
  }

  const affectedRows = await context.client.$executeRaw`
    UPDATE identity_refresh_credentials
    SET successor_id = UUID_TO_BIN(${successorId}, 0)
    WHERE id = UUID_TO_BIN(${predecessor.snapshot.id}, 0)
  `;

  assert.equal(affectedRows, 1);
}

async function insertAccessCredential(
  context: IntegrationContext,
  credential: StoredAccessCredential,
): Promise<void> {
  const affectedRows = await context.client.$executeRaw`
    INSERT INTO identity_access_credentials (
      id,
      family_id,
      digest,
      sequence,
      issued_at,
      expires_at
    ) VALUES (
      UUID_TO_BIN(${credential.id}, 0),
      UUID_TO_BIN(${credential.sessionId}, 0),
      ${credential.digestBytes},
      ${credential.sequence},
      CAST(${toMySqlDateTime6(credential.issuedAt)} AS DATETIME(6)),
      CAST(${toMySqlDateTime6(credential.expiresAt)} AS DATETIME(6))
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
    snapshot,
  });
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
  const credential = storedRefreshCredential(credentialSnapshot, digestBytes(index));

  await insertAccount(context, account);
  await insertSessionFamily(context, sessionFamily);
  await insertRefreshCredential(context, credential);

  return Object.freeze({ account, credential, sessionFamily });
}

async function createReuseDetectedFixture(
  context: IntegrationContext,
  index: number,
): Promise<ReuseDetectedFixture> {
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
  const lastRotatedAt = offsetInstant(context.fixtureNow, -120);
  const currentIdleExpiresAt = offsetInstant(context.fixtureNow, 3_480);
  const sessionFamily = IdentitySessionFamily.rehydrate({
    id: fixtureUuid(index, 2),
    accountId: account.id,
    version: 2,
    createdAt: familyCreatedAt,
    lastRotatedAt,
    refreshIdleExpiresAt: currentIdleExpiresAt,
    refreshAbsoluteExpiresAt: offsetInstant(familyCreatedAt, 86_400),
    revokedAt: null,
    closedReason: null,
  }).toSnapshot();
  const successorCredentialId = fixtureUuid(index, 4);
  const presentedCredential = storedRefreshCredential(
    IdentityRefreshCredential.rehydrate({
      id: fixtureUuid(index, 3),
      sessionId: sessionFamily.id,
      sequence: 1,
      issuedAt: familyCreatedAt,
      expiresAt: offsetInstant(familyCreatedAt, 20_000),
      consumedAt: lastRotatedAt,
      successorId: successorCredentialId,
    }).toSnapshot(),
    digestBytes(index),
  );
  const successorCredential = storedRefreshCredential(
    IdentityRefreshCredential.rehydrate({
      id: successorCredentialId,
      sessionId: sessionFamily.id,
      sequence: 2,
      issuedAt: lastRotatedAt,
      expiresAt: currentIdleExpiresAt,
      consumedAt: null,
      successorId: null,
    }).toSnapshot(),
    digestBytes(index + 50),
  );
  const accessDigestBytes = digestBytes(index + 100);
  const accessCredential = Object.freeze({
    digest: createIdentityAccessCredentialDigestFromBytes(accessDigestBytes),
    digestBytes: accessDigestBytes,
    expiresAt: offsetInstant(lastRotatedAt, 300),
    id: fixtureUuid(index, 5),
    issuedAt: lastRotatedAt,
    sequence: 2,
    sessionId: sessionFamily.id,
  });

  await insertAccount(context, account);
  await insertSessionFamily(context, sessionFamily);
  await insertConsumedRefreshCredentialWithoutSuccessor(context, presentedCredential);
  await insertRefreshCredential(context, successorCredential);
  await linkRefreshCredentialSuccessor(context, presentedCredential);
  await insertAccessCredential(context, accessCredential);

  return Object.freeze({
    accessCredential,
    account,
    decisionAccessCredentialId: fixtureUuid(index, 8),
    decisionSuccessorCredentialId: fixtureUuid(index, 7),
    eventId: parseIdentitySecurityEventId(fixtureUuid(index, 6)),
    presentedCredential,
    sessionFamily,
    successorCredential,
  });
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

async function credentialAttempt(
  fixture: ReuseDetectedFixture,
): Promise<IdentitySessionCredentialAttempt> {
  const candidates = createIdentitySessionCredentialCandidates({
    access: {
      wireValue: ACCESS_WIRE_VALUE,
      digest: fixture.accessCredential.digest,
    },
    refresh: {
      wireValue: REFRESH_WIRE_VALUE,
      digest: fixture.presentedCredential.digest,
    },
  });
  const crypto: IdentitySessionCredentialCrypto = Object.freeze({
    generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
      return Promise.resolve(candidates);
    },
    digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
      return Promise.resolve(fixture.accessCredential.digest);
    },
    digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
      return Promise.resolve(fixture.presentedCredential.digest);
    },
  });

  return createIdentitySessionCredentialAttempt(candidates, crypto);
}

async function readCredentialPersistenceState(
  context: IntegrationContext,
  sessionId: string,
): Promise<CredentialPersistenceState> {
  const refresh = await context.client.$queryRaw<readonly RefreshCredentialPersistenceRow[]>`
    SELECT
      LOWER(BIN_TO_UUID(id, 0)) AS credential_id,
      LOWER(BIN_TO_UUID(family_id, 0)) AS session_id,
      LOWER(HEX(digest)) AS digest_hex,
      sequence,
      DATE_FORMAT(issued_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS issued_at,
      DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS expires_at,
      DATE_FORMAT(consumed_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS consumed_at,
      LOWER(BIN_TO_UUID(successor_id, 0)) AS successor_id,
      active_slot
    FROM identity_refresh_credentials
    WHERE family_id = UUID_TO_BIN(${sessionId}, 0)
    ORDER BY sequence, id
  `;
  const access = await context.client.$queryRaw<readonly AccessCredentialPersistenceRow[]>`
    SELECT
      LOWER(BIN_TO_UUID(id, 0)) AS credential_id,
      LOWER(BIN_TO_UUID(family_id, 0)) AS session_id,
      LOWER(HEX(digest)) AS digest_hex,
      sequence,
      DATE_FORMAT(issued_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS issued_at,
      DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS expires_at
    FROM identity_access_credentials
    WHERE family_id = UUID_TO_BIN(${sessionId}, 0)
    ORDER BY sequence, id
  `;

  return Object.freeze({ access, refresh });
}

async function readSessionFamilyPersistence(
  context: IntegrationContext,
  sessionId: string,
): Promise<SessionFamilyPersistenceRow> {
  const rows = await context.client.$queryRaw<readonly SessionFamilyPersistenceRow[]>`
    SELECT
      LOWER(BIN_TO_UUID(id, 0)) AS session_id,
      version,
      DATE_FORMAT(last_rotated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS last_rotated_at,
      DATE_FORMAT(revoked_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS revoked_at,
      closed_reason
    FROM identity_session_families
    WHERE id = UUID_TO_BIN(${sessionId}, 0)
  `;
  const row = rows[0];

  if (row === undefined || rows.length !== 1) {
    throw new Error('Expected one reuse integration session family');
  }

  return row;
}

async function readSecurityEvents(
  context: IntegrationContext,
  sessionId: string,
): Promise<readonly SecurityEventPersistenceRow[]> {
  return context.client.$queryRaw<readonly SecurityEventPersistenceRow[]>`
    SELECT
      LOWER(BIN_TO_UUID(id, 0)) AS event_id,
      event_type,
      outcome,
      reason_code,
      LOWER(BIN_TO_UUID(actor_account_id, 0)) AS actor_account_id,
      LOWER(BIN_TO_UUID(subject_account_id, 0)) AS subject_account_id,
      LOWER(BIN_TO_UUID(role_id, 0)) AS role_id,
      LOWER(BIN_TO_UUID(session_id, 0)) AS session_id,
      permission_code,
      LOWER(BIN_TO_UUID(request_id, 0)) AS request_id,
      LOWER(BIN_TO_UUID(correlation_id, 0)) AS correlation_id,
      operator_reference,
      DATE_FORMAT(occurred_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS occurred_at
    FROM identity_security_events
    WHERE session_id = UUID_TO_BIN(${sessionId}, 0)
    ORDER BY occurred_at, id
  `;
}

async function insertPreexistingReuseSecurityEvent(
  context: IntegrationContext,
  fixture: ReuseDetectedFixture,
): Promise<void> {
  const affectedRows = await context.client.$executeRaw`
    INSERT INTO identity_security_events (
      id,
      event_type,
      outcome,
      reason_code,
      actor_account_id,
      subject_account_id,
      role_id,
      session_id,
      permission_code,
      request_id,
      correlation_id,
      operator_reference,
      occurred_at
    ) VALUES (
      UUID_TO_BIN(${fixture.eventId}, 0),
      'SESSION_REFRESH',
      'REJECTED',
      'REFRESH_REUSE_DETECTED',
      NULL,
      UUID_TO_BIN(${fixture.account.id}, 0),
      NULL,
      UUID_TO_BIN(${fixture.sessionFamily.id}, 0),
      NULL,
      NULL,
      NULL,
      NULL,
      CAST(${toMySqlDateTime6(context.fixtureNow)} AS DATETIME(6))
    )
  `;

  assert.equal(affectedRows, 1);
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

function createReuseDetectedProgram(
  client: PrismaClient,
  discovery: IdentitySessionRefreshDiscovery,
): MySqlTransactionProgram<
  ReuseDetectedProgramInput,
  ReuseDetectedProgramCommit,
  IdentitySessionRefreshMySqlTransactionFailure,
  ReuseDetectedProgramStatement
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
      const workflow = createIdentitySessionRefreshAttemptBoundWorkflow(input.attempt);

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
        const writer = createMySqlIdentitySessionRefreshReuseDetectedWriter(
          context,
          workflow.controller,
        );
        const load = await loader.loadForUpdate(transaction.scope, input.ticket);
        const decision = decideIdentitySessionRefresh(
          transaction,
          load,
          Object.freeze({
            successorRefreshCredentialId: input.successorRefreshCredentialId,
            refreshIdleLifetimeSeconds: 900,
            issuedAccessCredentialId: input.accessCredentialId,
            accessLifetimeSeconds: 300,
          }),
        );

        if (decision.kind !== 'reuse-detected') {
          throw new Error('Expected the consumed credential to produce a reuse decision');
        }

        try {
          const evidence = await writer.persistReuseDetected(
            transaction.scope,
            Object.freeze({ decision, securityEventId: input.eventId }),
          );

          return context.requestCommit(
            Object.freeze({ kind: evidence.kind, writerTime: transaction.dbNow }),
          );
        } catch (error: unknown) {
          if (isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(error)) {
            return context.requestRollback('conditional-conflict');
          }

          throw error;
        }
      } finally {
        closeIdentitySessionRefreshWorkflow(workflow.controller);
      }
    },
    statements: IDENTITY_SESSION_REFRESH_REUSE_PROGRAM_MYSQL_STATEMENTS,
    unavailableFailure: 'unavailable' as const,
  });
}

async function executeReuseDetected(
  context: IntegrationContext,
  fixture: ReuseDetectedFixture,
): Promise<
  MySqlTransactionOutcome<ReuseDetectedProgramCommit, IdentitySessionRefreshMySqlTransactionFailure>
> {
  const ticket = await discoverTicket(context, fixture.presentedCredential);
  const attempt = await credentialAttempt(fixture);
  const executor = createMySqlTransactionExecutor(
    context.runtime,
    createReuseDetectedProgram(context.client, context.discovery),
    { timeoutMilliseconds: TRANSACTION_TIMEOUT_MILLISECONDS },
  );

  return executor.execute(
    Object.freeze({
      accessCredentialId: fixture.decisionAccessCredentialId,
      attempt,
      eventId: fixture.eventId,
      successorRefreshCredentialId: fixture.decisionSuccessorCredentialId,
      ticket,
    }),
  );
}

async function cleanFixtures(context: IntegrationContext): Promise<void> {
  for (const index of FIXTURE_INDEXES) {
    const familyId = fixtureUuid(index, 2);
    const accountId = fixtureUuid(index, 1);

    await context.client.$executeRaw`
      DELETE FROM identity_security_events
      WHERE session_id = UUID_TO_BIN(${familyId}, 0)
    `;
    await context.client.$executeRaw`
      DELETE FROM identity_access_credentials
      WHERE family_id = UUID_TO_BIN(${familyId}, 0)
    `;
    await context.client.$executeRaw`
      UPDATE identity_refresh_credentials
      SET successor_id = NULL
      WHERE family_id = UUID_TO_BIN(${familyId}, 0)
        AND successor_id IS NOT NULL
    `;
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
  'Identity refresh direct transaction stores satisfy their prepared MySQL contract',
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

      await testContext.test(
        'atomically revokes a reused family and appends one rejected refresh event',
        async () => {
          const fixture = await createReuseDetectedFixture(integration, FIXTURE_INDEXES[2]);
          const credentialsBefore = await readCredentialPersistenceState(
            integration,
            fixture.sessionFamily.id,
          );
          const outcome = await executeReuseDetected(integration, fixture);

          if (outcome.kind !== 'committed') {
            throw new Error(`Expected committed reuse persistence, received ${outcome.kind}`);
          }

          assert.deepEqual(outcome.result, {
            kind: 'reuse-detected',
            writerTime: outcome.result.writerTime,
          });
          const family = await readSessionFamilyPersistence(integration, fixture.sessionFamily.id);
          const events = await readSecurityEvents(integration, fixture.sessionFamily.id);
          const credentialsAfter = await readCredentialPersistenceState(
            integration,
            fixture.sessionFamily.id,
          );

          assert.deepEqual(family, {
            closed_reason: 'REFRESH_REUSE_DETECTED',
            last_rotated_at: fixture.sessionFamily.lastRotatedAt,
            revoked_at: outcome.result.writerTime,
            session_id: fixture.sessionFamily.id,
            version: 3n,
          });
          assert.deepEqual(events, [
            {
              actor_account_id: null,
              correlation_id: null,
              event_id: fixture.eventId,
              event_type: 'SESSION_REFRESH',
              occurred_at: outcome.result.writerTime,
              operator_reference: null,
              outcome: 'REJECTED',
              permission_code: null,
              reason_code: 'REFRESH_REUSE_DETECTED',
              request_id: null,
              role_id: null,
              session_id: fixture.sessionFamily.id,
              subject_account_id: fixture.account.id,
            },
          ]);
          assert.equal(credentialsBefore.refresh.length, 2);
          assert.equal(credentialsBefore.access.length, 1);
          assert.deepEqual(credentialsAfter, credentialsBefore);
        },
      );

      await testContext.test(
        'rolls back the family update when a provider event-id collision is unavailable',
        async () => {
          const fixture = await createReuseDetectedFixture(integration, FIXTURE_INDEXES[3]);

          await insertPreexistingReuseSecurityEvent(integration, fixture);
          const familyBefore = await readSessionFamilyPersistence(
            integration,
            fixture.sessionFamily.id,
          );
          const credentialsBefore = await readCredentialPersistenceState(
            integration,
            fixture.sessionFamily.id,
          );
          const eventsBefore = await readSecurityEvents(integration, fixture.sessionFamily.id);
          const outcome = await executeReuseDetected(integration, fixture);

          assert.deepEqual(outcome, {
            failure: 'unavailable',
            kind: 'not-committed',
          });
          assert.deepEqual(
            await readSessionFamilyPersistence(integration, fixture.sessionFamily.id),
            familyBefore,
          );
          assert.deepEqual(
            await readCredentialPersistenceState(integration, fixture.sessionFamily.id),
            credentialsBefore,
          );
          assert.deepEqual(
            await readSecurityEvents(integration, fixture.sessionFamily.id),
            eventsBefore,
          );
          assert.deepEqual(familyBefore, {
            closed_reason: null,
            last_rotated_at: fixture.sessionFamily.lastRotatedAt,
            revoked_at: null,
            session_id: fixture.sessionFamily.id,
            version: 2n,
          });
          assert.equal(eventsBefore.length, 1);
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
