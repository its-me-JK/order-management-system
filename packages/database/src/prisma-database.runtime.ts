import { PrismaDatabaseDriver } from './client/prisma-database.driver';
import type { ManagedMariaDbConnectionLeaseOwner } from './client/managed-mariadb-connection-lease.owner';
import { ManagedDatabaseConnection } from './database.connection';
import type { DatabaseRuntime } from './database.contract';
import type { PrismaClient } from './generated/prisma/client';

const capturedFreeze = Object.freeze;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;

const runtimeClients = new WeakMap<DatabaseRuntime, PrismaClient>();
const runtimeMariaDbConnectionLeaseOwners = new WeakMap<
  DatabaseRuntime,
  ManagedMariaDbConnectionLeaseOwner<unknown>
>();
const RUNTIME_CONSTRUCTION_CAPABILITY = capturedFreeze({});
let constructManagedPrismaDatabaseRuntime:
  | ((
      client: PrismaClient,
      probeTimeoutMilliseconds: number,
      mariaDbConnectionLeaseOwner?: ManagedMariaDbConnectionLeaseOwner<unknown>,
    ) => DatabaseRuntime)
  | undefined;

function invalidRuntimeConstruction(): never {
  throw new TypeError('Invalid Prisma database runtime configuration');
}

function weakMapGet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  const value: unknown = capturedReflectApply(capturedWeakMapGet, map, [key]);
  return value as Value | undefined;
}

function weakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  capturedReflectApply(capturedWeakMapSet, map, [key, value]);
}

class ManagedPrismaDatabaseRuntime implements DatabaseRuntime {
  public readonly connection: ManagedDatabaseConnection;

  private constructor(
    constructionCapability: unknown,
    client: PrismaClient,
    probeTimeoutMilliseconds: number,
    mariaDbConnectionLeaseOwner?: ManagedMariaDbConnectionLeaseOwner<unknown>,
  ) {
    if (
      constructionCapability !== RUNTIME_CONSTRUCTION_CAPABILITY ||
      new.target !== ManagedPrismaDatabaseRuntime
    ) {
      invalidRuntimeConstruction();
    }

    this.connection = new ManagedDatabaseConnection(
      new PrismaDatabaseDriver(client, mariaDbConnectionLeaseOwner),
      probeTimeoutMilliseconds,
    );
    weakMapSet(runtimeClients, this, client);

    if (mariaDbConnectionLeaseOwner !== undefined) {
      weakMapSet(runtimeMariaDbConnectionLeaseOwners, this, mariaDbConnectionLeaseOwner);
    }

    capturedFreeze(this);
  }

  static {
    constructManagedPrismaDatabaseRuntime = (
      client,
      probeTimeoutMilliseconds,
      mariaDbConnectionLeaseOwner,
    ): DatabaseRuntime =>
      new ManagedPrismaDatabaseRuntime(
        RUNTIME_CONSTRUCTION_CAPABILITY,
        client,
        probeTimeoutMilliseconds,
        mariaDbConnectionLeaseOwner,
      );
  }

  public close(): Promise<void> {
    return this.connection.close();
  }
}

// Seal the recoverable implementation before either factory can release an
// instance. The lexical construction capability is never stored on a runtime.
capturedFreeze(ManagedPrismaDatabaseRuntime.prototype);
capturedFreeze(ManagedPrismaDatabaseRuntime);

function createManagedPrismaDatabaseRuntime(
  client: PrismaClient,
  probeTimeoutMilliseconds: number,
  mariaDbConnectionLeaseOwner?: ManagedMariaDbConnectionLeaseOwner<unknown>,
): DatabaseRuntime {
  const construct = constructManagedPrismaDatabaseRuntime;

  if (construct === undefined) {
    invalidRuntimeConstruction();
  }

  return construct(client, probeTimeoutMilliseconds, mariaDbConnectionLeaseOwner);
}

/**
 * Creates a runtime around an existing client without creating another pool.
 * Intended for composition roots and focused infrastructure tests.
 */
export function createPrismaDatabaseRuntime(
  client: PrismaClient,
  probeTimeoutMilliseconds = 1_000,
): DatabaseRuntime {
  return createManagedPrismaDatabaseRuntime(client, probeTimeoutMilliseconds);
}

/** @internal Creates a production runtime with its direct connection lease owner. */
export function createDatabaseResourcesRuntime<AllocatorOptions>(
  client: PrismaClient,
  mariaDbConnectionLeaseOwner: ManagedMariaDbConnectionLeaseOwner<AllocatorOptions>,
  probeTimeoutMilliseconds = 1_000,
): DatabaseRuntime {
  return createManagedPrismaDatabaseRuntime(
    client,
    probeTimeoutMilliseconds,
    mariaDbConnectionLeaseOwner as ManagedMariaDbConnectionLeaseOwner<unknown>,
  );
}

/**
 * Recovers the concrete client owned by a runtime created by this package.
 */
export function getPrismaClient(runtime: DatabaseRuntime): PrismaClient {
  const client = weakMapGet(runtimeClients, runtime);

  if (client === undefined) {
    throw new TypeError('Database runtime is not backed by a Prisma client');
  }

  return client;
}

/** @internal Recovers only the direct owner registered by the production factory. */
export function getRuntimeMariaDbConnectionLeaseOwner(
  runtime: DatabaseRuntime,
): ManagedMariaDbConnectionLeaseOwner<unknown> {
  const owner = weakMapGet(runtimeMariaDbConnectionLeaseOwners, runtime);

  if (owner === undefined) {
    throw new TypeError('Database runtime has no direct MariaDB connection authority');
  }

  return owner;
}
