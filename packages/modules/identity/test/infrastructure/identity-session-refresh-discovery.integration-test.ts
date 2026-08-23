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
import { getPrismaClient, type PrismaClient } from '@oms/database/prisma';
import { config as loadEnvironment } from 'dotenv';

import {
  consumeIdentitySessionRefreshDiscoveryFoundTicket,
  IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
  IdentitySessionRefreshDiscoveryUnavailableError,
  type IdentitySessionRefreshDiscovery,
} from '../../src/application/identity-session-refresh-discovery';
import {
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityRefreshCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import { createPrismaIdentitySessionRefreshDiscovery } from '../../src/infrastructure/prisma';
import { inspectPrismaIdentitySessionRefreshDiscoveryAuthority } from '../../src/infrastructure/prisma/prisma-identity-session-refresh-discovery';

const REFRESH_DISCOVERY_INTEGRATION_CONFIRMATION_VARIABLE =
  'IDENTITY_REFRESH_DISCOVERY_INTEGRATION_CONFIRM_DATABASE';
const REFRESH_DISCOVERY_INTEGRATION_DATABASE = 'oms_identity_refresh_discovery_integration';
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

type StoredRefreshCredential = Readonly<{
  digest: IdentityRefreshCredentialDigest;
  digestBytes: Uint8Array<ArrayBuffer>;
  id: string;
}>;

type RefreshDiscoveryFixture = Readonly<{
  accountId: string;
  current: StoredRefreshCredential;
  predecessor?: StoredRefreshCredential;
  sessionId: string;
}>;

type IntegrationContext = Readonly<{
  client: PrismaClient;
  discovery: IdentitySessionRefreshDiscovery;
  now: Date;
  options: DatabaseConnectionOptions;
  runtime: DatabaseRuntime;
}>;

type ExplainRow = Readonly<{
  key: string | null;
  table: string | null;
  type: string;
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
  const confirmedDatabase = process.env[REFRESH_DISCOVERY_INTEGRATION_CONFIRMATION_VARIABLE];
  const isDedicatedTarget =
    LOOPBACK_DATABASE_HOSTS.has(options.host) &&
    !options.tls.enabled &&
    options.database === REFRESH_DISCOVERY_INTEGRATION_DATABASE;

  if (!isDedicatedTarget || confirmedDatabase !== options.database) {
    throw new Error(
      'Identity refresh-discovery integration tests require the dedicated loopback, non-TLS ' +
        'database and an exact confirmation variable',
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
    throw new Error('Invalid integration UUIDv7');
  }

  const bytes = Uint8Array.from(Buffer.from(value.replaceAll('-', ''), 'hex'));

  if (bytes.byteLength !== 16) {
    throw new Error('Invalid integration UUID bytes');
  }

  return bytes;
}

function digestBytes(seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_value, index): number => (seed * 37 + index * 11) % 256);
}

function atOffset(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1_000);
}

function storedRefreshCredential(
  id: string,
  rawDigest: Uint8Array<ArrayBuffer>,
): StoredRefreshCredential {
  return Object.freeze({
    digest: createIdentityRefreshCredentialDigestFromBytes(rawDigest),
    digestBytes: rawDigest,
    id,
  });
}

async function openContext(): Promise<IntegrationContext> {
  const options = databaseOptions();
  const runtime = createDatabaseRuntime(options);
  const client = getPrismaClient(runtime);

  await runtime.connection.probe();
  await client.$connect();

  const clockRows = await client.$queryRaw<readonly { db_now: Date }[]>`
    SELECT CURRENT_TIMESTAMP(6) AS db_now
  `;
  const now = clockRows[0]?.db_now;

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    await runtime.close();
    throw new Error('MySQL returned an invalid integration clock');
  }

  return {
    client,
    discovery: createPrismaIdentitySessionRefreshDiscovery(client),
    now,
    options,
    runtime,
  };
}

async function createActiveFixture(
  context: IntegrationContext,
  index: number,
  accessDigestBytes?: Uint8Array<ArrayBuffer>,
): Promise<RefreshDiscoveryFixture> {
  const accountId = fixtureUuid(index, 1);
  const sessionId = fixtureUuid(index, 2);
  const refreshId = fixtureUuid(index, 3);
  const rawRefreshDigest = digestBytes(index * 10 + 1);
  const accountCreatedAt = atOffset(context.now, -100_000);
  const familyCreatedAt = atOffset(context.now, -120);

  await context.client.identityAccountRecord.create({
    data: {
      id: uuidBytes(accountId),
      loginName: `ird-${String(index)}`,
      status: 'ACTIVE',
      version: 1,
      createdAt: accountCreatedAt,
      updatedAt: accountCreatedAt,
      suspendedAt: null,
      deactivatedAt: null,
    },
  });
  await context.client.identitySessionFamilyRecord.create({
    data: {
      id: uuidBytes(sessionId),
      accountId: uuidBytes(accountId),
      version: 1,
      createdAt: familyCreatedAt,
      lastRotatedAt: familyCreatedAt,
      idleExpiresAt: atOffset(context.now, 3_480),
      absoluteExpiresAt: atOffset(context.now, 86_280),
      revokedAt: null,
      closedReason: null,
    },
  });
  await context.client.identityRefreshCredentialRecord.create({
    data: {
      id: uuidBytes(refreshId),
      familyId: uuidBytes(sessionId),
      digest: rawRefreshDigest,
      sequence: 1,
      issuedAt: familyCreatedAt,
      expiresAt: atOffset(context.now, 3_480),
      consumedAt: null,
      successorId: null,
      activeSlot: 1,
    },
  });

  if (accessDigestBytes !== undefined) {
    await context.client.identityAccessCredentialRecord.create({
      data: {
        id: uuidBytes(fixtureUuid(index, 4)),
        familyId: uuidBytes(sessionId),
        digest: accessDigestBytes,
        sequence: 1,
        issuedAt: familyCreatedAt,
        expiresAt: atOffset(context.now, 780),
      },
    });
  }

  return Object.freeze({
    accountId,
    current: storedRefreshCredential(refreshId, rawRefreshDigest),
    sessionId,
  });
}

async function createTwoGenerationFixture(
  context: IntegrationContext,
  index: number,
  lifecycleBlind: boolean,
): Promise<RefreshDiscoveryFixture> {
  const accountId = fixtureUuid(index, 1);
  const sessionId = fixtureUuid(index, 2);
  const predecessorId = fixtureUuid(index, 3);
  const currentId = fixtureUuid(index, 4);
  const predecessorDigest = digestBytes(index * 10 + 1);
  const currentDigest = digestBytes(index * 10 + 2);
  const accountCreatedAt = atOffset(context.now, -100_000);
  const accountChangedAt = atOffset(context.now, -1);
  const familyCreatedAtSeconds = lifecycleBlind ? -90_000 : -600;
  const lastRotatedAtSeconds = lifecycleBlind ? -80_000 : -300;
  const predecessorExpiresAtSeconds = lifecycleBlind ? -3_600 : 3_000;
  const currentExpiresAtSeconds = lifecycleBlind ? -4_000 : 3_300;

  await context.client.identityAccountRecord.create({
    data: {
      id: uuidBytes(accountId),
      loginName: `ird-${String(index)}`,
      status: lifecycleBlind ? 'SUSPENDED' : 'ACTIVE',
      version: lifecycleBlind ? 2 : 1,
      createdAt: accountCreatedAt,
      updatedAt: lifecycleBlind ? accountChangedAt : accountCreatedAt,
      suspendedAt: lifecycleBlind ? accountChangedAt : null,
      deactivatedAt: null,
    },
  });
  await context.client.identitySessionFamilyRecord.create({
    data: {
      id: uuidBytes(sessionId),
      accountId: uuidBytes(accountId),
      version: lifecycleBlind ? 3 : 2,
      createdAt: atOffset(context.now, familyCreatedAtSeconds),
      lastRotatedAt: atOffset(context.now, lastRotatedAtSeconds),
      idleExpiresAt: atOffset(context.now, lifecycleBlind ? -4_000 : 3_300),
      absoluteExpiresAt: atOffset(context.now, lifecycleBlind ? -3_600 : 85_800),
      revokedAt: lifecycleBlind ? atOffset(context.now, -5_000) : null,
      closedReason: lifecycleBlind ? 'LOGOUT' : null,
    },
  });
  await context.client.identityRefreshCredentialRecord.create({
    data: {
      id: uuidBytes(predecessorId),
      familyId: uuidBytes(sessionId),
      digest: predecessorDigest,
      sequence: 1,
      issuedAt: atOffset(context.now, familyCreatedAtSeconds),
      expiresAt: atOffset(context.now, predecessorExpiresAtSeconds),
      consumedAt: atOffset(context.now, lastRotatedAtSeconds),
      successorId: null,
      activeSlot: null,
    },
  });
  await context.client.identityRefreshCredentialRecord.create({
    data: {
      id: uuidBytes(currentId),
      familyId: uuidBytes(sessionId),
      digest: currentDigest,
      sequence: 2,
      issuedAt: atOffset(context.now, lastRotatedAtSeconds),
      expiresAt: atOffset(context.now, currentExpiresAtSeconds),
      consumedAt: null,
      successorId: null,
      activeSlot: 1,
    },
  });
  await context.client.identityRefreshCredentialRecord.update({
    where: { id: uuidBytes(predecessorId) },
    data: { successorId: uuidBytes(currentId) },
  });

  return Object.freeze({
    accountId,
    current: storedRefreshCredential(currentId, currentDigest),
    predecessor: storedRefreshCredential(predecessorId, predecessorDigest),
    sessionId,
  });
}

function assertFound(
  result: unknown,
  fixture: RefreshDiscoveryFixture,
  credential: StoredRefreshCredential,
): void {
  assert.deepEqual(result, {
    kind: 'found',
    accountId: fixture.accountId,
    sessionId: fixture.sessionId,
    presentedRefreshCredentialId: credential.id,
  });
  assert.equal(Object.isFrozen(result), true);
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

async function assertRealOutageIsUnavailable(context: IntegrationContext): Promise<void> {
  const sockets = new Set<Socket>();
  const server = createServer((socket): void => {
    sockets.add(socket);
    socket.once('close', (): void => {
      sockets.delete(socket);
    });
  });
  const port = await listen(server);
  const runtime = createDatabaseRuntime({
    ...context.options,
    acquireTimeoutMilliseconds: 500,
    connectTimeoutMilliseconds: 100,
    connectionLimit: 1,
    host: '127.0.0.1',
    port,
    tls: { enabled: false },
  });
  const discovery = createPrismaIdentitySessionRefreshDiscovery(getPrismaClient(runtime));

  try {
    await assert.rejects(
      discovery.findByRefreshCredentialDigest(
        createIdentityRefreshCredentialDigestFromBytes(digestBytes(248)),
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof IdentitySessionRefreshDiscoveryUnavailableError);
        assert.equal(
          error.message,
          'Identity session refresh discovery is temporarily unavailable',
        );
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  } finally {
    await closeServer(server, sockets);
    await runtime.close();
  }
}

void test('Identity session refresh discovery satisfies its real-MySQL contract', async (testContext) => {
  const integration = await openContext();

  try {
    await testContext.test('finds one retained refresh credential by its digest', async () => {
      const fixture = await createActiveFixture(integration, 1);
      const result = await integration.discovery.findByRefreshCredentialDigest(
        fixture.current.digest,
      );

      assertFound(result, fixture, fixture.current);

      if (result.kind !== 'found') {
        throw new Error('Expected a found discovery ticket');
      }

      const authority = inspectPrismaIdentitySessionRefreshDiscoveryAuthority(
        integration.discovery,
        integration.client,
      );
      const consumed = consumeIdentitySessionRefreshDiscoveryFoundTicket(authority, result);

      assert.equal(consumed.refreshCredentialDigest, fixture.current.digest);
      assert.equal(consumed.accountId, fixture.accountId);
      assert.equal(consumed.sessionId, fixture.sessionId);
      assert.equal(consumed.presentedRefreshCredentialId, fixture.current.id);
    });

    await testContext.test(
      'finds a consumed and expired predecessor in an expired, revoked, inactive session',
      async () => {
        const fixture = await createTwoGenerationFixture(integration, 2, true);
        const predecessor = fixture.predecessor;

        if (predecessor === undefined) {
          throw new Error('Expected a retained predecessor fixture');
        }

        const result = await integration.discovery.findByRefreshCredentialDigest(
          predecessor.digest,
        );

        assertFound(result, fixture, predecessor);
      },
    );

    await testContext.test('keeps retained credential generations distinct', async () => {
      const fixture = await createTwoGenerationFixture(integration, 3, false);
      const predecessor = fixture.predecessor;

      if (predecessor === undefined) {
        throw new Error('Expected a retained predecessor fixture');
      }

      assertFound(
        await integration.discovery.findByRefreshCredentialDigest(predecessor.digest),
        fixture,
        predecessor,
      );
      assertFound(
        await integration.discovery.findByRefreshCredentialDigest(fixture.current.digest),
        fixture,
        fixture.current,
      );
    });

    await testContext.test(
      'does not find unknown digests or digests retained only in the access table',
      async () => {
        const accessOnlyDigestBytes = digestBytes(249);
        await createActiveFixture(integration, 4, accessOnlyDigestBytes);
        const accessOnlyDigest =
          createIdentityRefreshCredentialDigestFromBytes(accessOnlyDigestBytes);
        const unknownDigest = createIdentityRefreshCredentialDigestFromBytes(digestBytes(250));

        assert.equal(
          await integration.discovery.findByRefreshCredentialDigest(accessOnlyDigest),
          IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
        );
        assert.equal(
          await integration.discovery.findByRefreshCredentialDigest(unknownDigest),
          IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
        );
      },
    );

    await testContext.test(
      'uses the unique refresh-digest index for the production query shape',
      async () => {
        const fixture = await createActiveFixture(integration, 5);
        const planRows = await integration.client.$queryRaw<readonly ExplainRow[]>`
        EXPLAIN
        SELECT
          LOWER(BIN_TO_UUID(refresh.family_id, 0)) AS refresh_family_id,
          LOWER(BIN_TO_UUID(family.id, 0)) AS loaded_session_id,
          LOWER(BIN_TO_UUID(family.account_id, 0)) AS family_account_id,
          LOWER(BIN_TO_UUID(account.id, 0)) AS loaded_account_id,
          LOWER(BIN_TO_UUID(refresh.id, 0)) AS presented_refresh_credential_id
        FROM identity_refresh_credentials AS refresh
        LEFT JOIN identity_session_families AS family
          ON family.id = refresh.family_id
        LEFT JOIN identity_accounts AS account
          ON account.id = family.account_id
        WHERE refresh.digest = ${fixture.current.digestBytes}
        LIMIT ${2}
      `;
        const refreshPlan = planRows.find((row) => row.table === 'refresh');
        const familyPlan = planRows.find((row) => row.table === 'family');
        const accountPlan = planRows.find((row) => row.table === 'account');

        assert.equal(refreshPlan?.key, 'uq_identity_refresh_credentials_digest');
        assert.equal(refreshPlan.type, 'const');
        assert.equal(familyPlan?.key, 'PRIMARY');
        assert.equal(familyPlan.type, 'const');
        assert.equal(accountPlan?.key, 'PRIMARY');
        assert.equal(accountPlan.type, 'const');
      },
    );

    await testContext.test(
      'classifies a real stalled MySQL connection as unavailable',
      async () => {
        await assertRealOutageIsUnavailable(integration);
      },
    );
  } finally {
    await integration.runtime.close();
  }
});
