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

import { IDENTITY_ACCESS_AUTHORITY_REJECTED } from '../../src/application/identity-access-authority.reader';
import { IdentityAccessAuthorityUnavailableError } from '../../src/application/identity-access-authority.errors';
import { InvalidIdentityAuthenticatedPrincipalError } from '../../src/application/identity-authenticated-principal.errors';
import {
  createIdentityAccessCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import { PrismaIdentityAccessAuthorityReader } from '../../src/infrastructure/prisma';

const AUTHORITY_INTEGRATION_CONFIRMATION_VARIABLE =
  'IDENTITY_AUTHORITY_INTEGRATION_CONFIRM_DATABASE';
const AUTHORITY_INTEGRATION_DATABASE = 'oms_identity_authority_integration';
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const SYSTEM_ADMINISTRATOR_ROLE_ID = '01a02f59-a800-7000-8000-000000000001';
const SYSTEM_PERMISSIONS = Object.freeze([
  'audit.records.read',
  'catalog.products.publish',
  'catalog.products.read',
  'catalog.products.write',
  'catalog.skus.publish',
  'catalog.skus.read',
  'catalog.skus.write',
]);

type FixtureOptions = Readonly<{
  absoluteExpiresAtSeconds?: number;
  accessExpiresAtSeconds?: number;
  accessIssuedAtSeconds?: number;
  accountStatus?: 'ACTIVE' | 'SUSPENDED';
  familyCreatedAtSeconds?: number;
  familyVersion?: number;
  idleExpiresAtSeconds?: number;
  lastRotatedAtSeconds?: number;
  refreshConsumedAtSeconds?: number | null;
  refreshExpiresAtSeconds?: number;
  refreshIssuedAtSeconds?: number;
  revokedAtSeconds?: number | null;
  sequence?: number;
}>;

type AuthorityFixture = Readonly<{
  accountId: Uint8Array<ArrayBuffer>;
  digest: IdentityAccessCredentialDigest;
}>;

type IntegrationContext = Readonly<{
  client: PrismaClient;
  now: Date;
  options: DatabaseConnectionOptions;
  reader: PrismaIdentityAccessAuthorityReader;
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
  const confirmedDatabase = process.env[AUTHORITY_INTEGRATION_CONFIRMATION_VARIABLE];
  const isDedicatedTarget =
    LOOPBACK_DATABASE_HOSTS.has(options.host) &&
    !options.tls.enabled &&
    options.database === AUTHORITY_INTEGRATION_DATABASE;

  if (!isDedicatedTarget || confirmedDatabase !== options.database) {
    throw new Error(
      'Identity authority integration tests require the dedicated loopback, non-TLS ' +
        'database and an exact confirmation variable',
    );
  }

  return options;
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

function fixtureUuid(index: number, discriminator: number): string {
  const suffix = String(index * 10 + discriminator).padStart(12, '0');
  return `01890f3a-8bcd-7def-8abc-${suffix}`;
}

function boundRoleUuid(index: number): string {
  return `01890f3a-8bcd-7def-aabc-${String(index).padStart(12, '0')}`;
}

function digestBytes(seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_value, index): number => (seed * 37 + index * 11) % 256);
}

function atOffset(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1_000);
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
    now,
    options,
    reader: new PrismaIdentityAccessAuthorityReader(client),
    runtime,
  };
}

async function createAuthorityFixture(
  context: IntegrationContext,
  index: number,
  options: FixtureOptions = {},
): Promise<AuthorityFixture> {
  const familyCreatedAtSeconds = options.familyCreatedAtSeconds ?? -60;
  const lastRotatedAtSeconds = options.lastRotatedAtSeconds ?? -60;
  const idleExpiresAtSeconds = options.idleExpiresAtSeconds ?? 3_540;
  const absoluteExpiresAtSeconds = options.absoluteExpiresAtSeconds ?? 86_340;
  const refreshIssuedAtSeconds = options.refreshIssuedAtSeconds ?? -60;
  const refreshExpiresAtSeconds = options.refreshExpiresAtSeconds ?? 3_540;
  const accessIssuedAtSeconds = options.accessIssuedAtSeconds ?? -60;
  const accessExpiresAtSeconds = options.accessExpiresAtSeconds ?? 840;
  const refreshConsumedAtSeconds = options.refreshConsumedAtSeconds ?? null;
  const revokedAtSeconds = options.revokedAtSeconds ?? null;
  const accountStatus = options.accountStatus ?? 'ACTIVE';
  const sequence = options.sequence ?? 1;
  const accountId = uuidBytes(fixtureUuid(index, 1));
  const familyId = uuidBytes(fixtureUuid(index, 2));
  const refreshId = uuidBytes(fixtureUuid(index, 3));
  const accessId = uuidBytes(fixtureUuid(index, 4));
  const rawDigest = digestBytes(index);
  const accountCreatedAt = atOffset(context.now, -90_000);
  const accountChangedAt = atOffset(context.now, -1);

  await context.client.identityAccountRecord.create({
    data: {
      id: accountId,
      loginName: `ita-${String(index)}`,
      status: accountStatus,
      version: accountStatus === 'ACTIVE' ? 1 : 2,
      createdAt: accountCreatedAt,
      updatedAt: accountStatus === 'ACTIVE' ? accountCreatedAt : accountChangedAt,
      suspendedAt: accountStatus === 'SUSPENDED' ? accountChangedAt : null,
      deactivatedAt: null,
    },
  });

  await context.client.identitySessionFamilyRecord.create({
    data: {
      id: familyId,
      accountId,
      version: options.familyVersion ?? (revokedAtSeconds === null ? 1 : 2),
      createdAt: atOffset(context.now, familyCreatedAtSeconds),
      lastRotatedAt: atOffset(context.now, lastRotatedAtSeconds),
      idleExpiresAt: atOffset(context.now, idleExpiresAtSeconds),
      absoluteExpiresAt: atOffset(context.now, absoluteExpiresAtSeconds),
      revokedAt: revokedAtSeconds === null ? null : atOffset(context.now, revokedAtSeconds),
      closedReason: revokedAtSeconds === null ? null : 'LOGOUT',
    },
  });

  await context.client.identityRefreshCredentialRecord.create({
    data: {
      id: refreshId,
      familyId,
      digest: digestBytes(index + 1_000),
      sequence,
      issuedAt: atOffset(context.now, refreshIssuedAtSeconds),
      expiresAt: atOffset(context.now, refreshExpiresAtSeconds),
      consumedAt:
        refreshConsumedAtSeconds === null ? null : atOffset(context.now, refreshConsumedAtSeconds),
      successorId: null,
      activeSlot: refreshConsumedAtSeconds === null ? 1 : null,
    },
  });

  await context.client.identityAccessCredentialRecord.create({
    data: {
      id: accessId,
      familyId,
      digest: rawDigest,
      sequence,
      issuedAt: atOffset(context.now, accessIssuedAtSeconds),
      expiresAt: atOffset(context.now, accessExpiresAtSeconds),
    },
  });

  return {
    accountId,
    digest: createIdentityAccessCredentialDigestFromBytes(rawDigest),
  };
}

async function assignRole(
  context: IntegrationContext,
  accountId: Uint8Array<ArrayBuffer>,
  roleId: string,
): Promise<void> {
  await context.client.identityAccountRoleRecord.create({
    data: {
      accountId,
      roleId: uuidBytes(roleId),
    },
  });
}

function expectedPrincipal(
  permissions: readonly string[],
  index: number,
): Readonly<{
  kind: 'resolved';
  principal: Readonly<{
    actorId: string;
    sessionId: string;
    permissions: readonly string[];
  }>;
}> {
  return {
    kind: 'resolved',
    principal: {
      actorId: fixtureUuid(index, 1),
      sessionId: fixtureUuid(index, 2),
      permissions,
    },
  };
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
  const reader = new PrismaIdentityAccessAuthorityReader(getPrismaClient(runtime));

  try {
    await assert.rejects(
      reader.resolveByAccessCredentialDigest(
        createIdentityAccessCredentialDigestFromBytes(digestBytes(250)),
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof IdentityAccessAuthorityUnavailableError);
        assert.equal(error.message, 'Identity access authority is temporarily unavailable');
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  } finally {
    await closeServer(server, sockets);
    await runtime.close();
  }
}

void test('Identity access authority satisfies its real-MySQL contract', async (testContext) => {
  const integration = await openContext();

  try {
    await testContext.test(
      'resolves current permissions and observes changes on the next read',
      async () => {
        const fixture = await createAuthorityFixture(integration, 1);
        await assignRole(integration, fixture.accountId, SYSTEM_ADMINISTRATOR_ROLE_ID);

        assert.deepEqual(
          await integration.reader.resolveByAccessCredentialDigest(fixture.digest),
          expectedPrincipal(SYSTEM_PERMISSIONS, 1),
        );

        const extraRoleId = boundRoleUuid(900);
        await integration.client.identityRoleRecord.create({
          data: {
            id: uuidBytes(extraRoleId),
            code: 'IT_AUTHORITY_DUPLICATE',
            displayName: 'Integration duplicate authority',
            status: 'ACTIVE',
            version: 1,
            createdAt: integration.now,
            updatedAt: integration.now,
            retiredAt: null,
          },
        });
        await integration.client.identityRolePermissionRecord.create({
          data: {
            roleId: uuidBytes(extraRoleId),
            permissionCode: 'catalog.products.read',
          },
        });
        await assignRole(integration, fixture.accountId, extraRoleId);

        assert.deepEqual(
          await integration.reader.resolveByAccessCredentialDigest(fixture.digest),
          expectedPrincipal(SYSTEM_PERMISSIONS, 1),
        );

        const retiredAt = atOffset(integration.now, 1);
        await integration.client.identityRoleRecord.update({
          where: { id: uuidBytes(extraRoleId) },
          data: {
            status: 'RETIRED',
            version: 2,
            updatedAt: retiredAt,
            retiredAt,
          },
        });
        await integration.client.identityAccountRoleRecord.delete({
          where: {
            accountId_roleId: {
              accountId: fixture.accountId,
              roleId: uuidBytes(SYSTEM_ADMINISTRATOR_ROLE_ID),
            },
          },
        });

        assert.deepEqual(
          await integration.reader.resolveByAccessCredentialDigest(fixture.digest),
          expectedPrincipal([], 1),
        );
      },
    );

    await testContext.test(
      'does not gate access on consumed refresh or elapsed idle expiry',
      async () => {
        const fixture = await createAuthorityFixture(integration, 2, {
          familyCreatedAtSeconds: -1_000,
          lastRotatedAtSeconds: -1_000,
          idleExpiresAtSeconds: -100,
          absoluteExpiresAtSeconds: 85_400,
          refreshIssuedAtSeconds: -1_000,
          refreshExpiresAtSeconds: -100,
          refreshConsumedAtSeconds: -900,
          accessIssuedAtSeconds: -1_000,
          accessExpiresAtSeconds: 800,
        });

        assert.deepEqual(
          await integration.reader.resolveByAccessCredentialDigest(fixture.digest),
          expectedPrincipal([], 2),
        );
      },
    );

    await testContext.test(
      'collapses every ordinary ineligible credential to one rejection',
      async () => {
        const unknown = createIdentityAccessCredentialDigestFromBytes(digestBytes(249));
        assert.equal(
          await integration.reader.resolveByAccessCredentialDigest(unknown),
          IDENTITY_ACCESS_AUTHORITY_REJECTED,
        );

        const fixtures = [
          await createAuthorityFixture(integration, 3, {
            familyCreatedAtSeconds: -1_000,
            lastRotatedAtSeconds: -1_000,
            idleExpiresAtSeconds: 2_600,
            absoluteExpiresAtSeconds: 85_400,
            refreshIssuedAtSeconds: -1_000,
            refreshExpiresAtSeconds: 2_600,
            accessIssuedAtSeconds: -1_000,
            accessExpiresAtSeconds: -100,
          }),
          await createAuthorityFixture(integration, 4, {
            familyVersion: 2,
            revokedAtSeconds: -1,
          }),
          await createAuthorityFixture(integration, 5, { accountStatus: 'SUSPENDED' }),
          await createAuthorityFixture(integration, 6, {
            familyCreatedAtSeconds: -86_500,
            familyVersion: 2,
            lastRotatedAtSeconds: -1_000,
            idleExpiresAtSeconds: -100,
            absoluteExpiresAtSeconds: -100,
            sequence: 2,
            refreshIssuedAtSeconds: -1_000,
            refreshExpiresAtSeconds: -100,
            accessIssuedAtSeconds: -1_000,
            accessExpiresAtSeconds: -100,
          }),
        ];

        for (const fixture of fixtures) {
          assert.equal(
            await integration.reader.resolveByAccessCredentialDigest(fixture.digest),
            IDENTITY_ACCESS_AUTHORITY_REJECTED,
          );
        }
      },
    );

    await testContext.test(
      'rejects schema-legal cross-row corruption as internal authority failure',
      async () => {
        const fixtures = [
          await createAuthorityFixture(integration, 7, {
            familyVersion: 2,
            lastRotatedAtSeconds: -59,
            sequence: 2,
            refreshIssuedAtSeconds: -60,
            accessIssuedAtSeconds: -59,
          }),
          await createAuthorityFixture(integration, 8, {
            familyVersion: 1,
            sequence: 2,
          }),
          await createAuthorityFixture(integration, 9, {
            familyCreatedAtSeconds: -86_390,
            familyVersion: 2,
            lastRotatedAtSeconds: -10,
            idleExpiresAtSeconds: 10,
            absoluteExpiresAtSeconds: 10,
            sequence: 2,
            refreshIssuedAtSeconds: -10,
            refreshExpiresAtSeconds: 10,
            accessIssuedAtSeconds: -10,
            accessExpiresAtSeconds: 290,
          }),
          await createAuthorityFixture(integration, 10, {
            lastRotatedAtSeconds: -60,
            refreshIssuedAtSeconds: -59,
            refreshExpiresAtSeconds: 3_541,
            accessIssuedAtSeconds: -59,
            accessExpiresAtSeconds: 841,
          }),
          await createAuthorityFixture(integration, 11, {
            accessExpiresAtSeconds: 60,
          }),
          await createAuthorityFixture(integration, 12, {
            accessExpiresAtSeconds: 240.5,
          }),
        ];

        for (const fixture of fixtures) {
          await assert.rejects(
            integration.reader.resolveByAccessCredentialDigest(fixture.digest),
            InvalidIdentityAuthenticatedPrincipalError,
          );
        }
      },
    );

    await testContext.test(
      'accepts a short access lifetime clipped by the family absolute deadline',
      async () => {
        const fixture = await createAuthorityFixture(integration, 13, {
          familyCreatedAtSeconds: -86_280,
          familyVersion: 2,
          lastRotatedAtSeconds: -10,
          idleExpiresAtSeconds: 120,
          absoluteExpiresAtSeconds: 120,
          sequence: 2,
          refreshIssuedAtSeconds: -10,
          refreshExpiresAtSeconds: 120,
          accessIssuedAtSeconds: -10,
          accessExpiresAtSeconds: 120,
        });

        assert.deepEqual(
          await integration.reader.resolveByAccessCredentialDigest(fixture.digest),
          expectedPrincipal([], 13),
        );
      },
    );

    await testContext.test(
      'accepts 2,048 mapping rows and rejects the overflow sentinel',
      async () => {
        const fixture = await createAuthorityFixture(integration, 20);
        const permissions = Array.from(
          { length: 128 },
          (_value, index): string => `identity.bound.permission-${String(index).padStart(3, '0')}`,
        );
        const roleIds = Array.from({ length: 17 }, (_value, index): string =>
          boundRoleUuid(index + 1),
        );

        await integration.client.identityPermissionRecord.createMany({
          data: permissions.map((code, index) => ({
            code,
            description: `Authority bound permission ${String(index).padStart(3, '0')}.`,
          })),
        });
        await integration.client.identityRoleRecord.createMany({
          data: roleIds.map((id, index) => ({
            id: uuidBytes(id),
            code: `IT_BOUND_ROLE_${String(index).padStart(2, '0')}`,
            displayName: `Integration bound role ${String(index).padStart(2, '0')}`,
            status: 'ACTIVE',
            version: 1,
            createdAt: integration.now,
            updatedAt: integration.now,
            retiredAt: null,
          })),
        });
        await integration.client.identityAccountRoleRecord.createMany({
          data: roleIds.slice(0, 16).map((id) => ({
            accountId: fixture.accountId,
            roleId: uuidBytes(id),
          })),
        });
        await integration.client.identityRolePermissionRecord.createMany({
          data: roleIds.slice(0, 16).flatMap((id) =>
            permissions.map((permissionCode) => ({
              roleId: uuidBytes(id),
              permissionCode,
            })),
          ),
        });

        assert.deepEqual(
          await integration.reader.resolveByAccessCredentialDigest(fixture.digest),
          expectedPrincipal(permissions, 20),
        );

        const overflowRoleId = roleIds[16];

        if (overflowRoleId === undefined) {
          throw new Error('Expected the seventeenth integration role');
        }

        await assignRole(integration, fixture.accountId, overflowRoleId);
        await assert.rejects(
          integration.reader.resolveByAccessCredentialDigest(fixture.digest),
          InvalidIdentityAuthenticatedPrincipalError,
        );
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
