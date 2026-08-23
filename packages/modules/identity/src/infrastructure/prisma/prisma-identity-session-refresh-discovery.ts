import { isPrismaDatabaseUnavailableError, type PrismaClient } from '@oms/database/prisma';

import {
  createIdentitySessionRefreshDiscoveryBoundaryAuthority,
  createIdentitySessionRefreshDiscoveryFoundTicket,
  IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND,
  IdentitySessionRefreshDiscoveryPersistenceError,
  IdentitySessionRefreshDiscoveryUnavailableError,
  type IdentitySessionRefreshDiscovery,
  type IdentitySessionRefreshDiscoveryBoundaryAuthority,
  type IdentitySessionRefreshDiscoveryResult,
} from '../../application/identity-session-refresh-discovery';
import {
  copyIdentityRefreshCredentialDigestBytes,
  IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
  type IdentityRefreshCredentialDigest,
} from '../../application/identity-session-credential-digest.values';

const IDENTITY_SESSION_REFRESH_DISCOVERY_ROW_KEYS = Object.freeze([
  'refresh_family_id',
  'loaded_session_id',
  'family_account_id',
  'loaded_account_id',
  'presented_refresh_credential_id',
] as const);
const IDENTITY_SESSION_REFRESH_DISCOVERY_OVERFLOW_PROBE_ROW_COUNT = 2;
const IDENTITY_SESSION_REFRESH_DISCOVERY_CONSTRUCTION_CAPABILITY = Object.freeze({});
const IDENTITY_SESSION_REFRESH_DISCOVERY_NO_ROW = Object.freeze({ kind: 'not-found' as const });
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedOwnKeys = Reflect.ownKeys;
const capturedPromiseResolve: (value: unknown) => Promise<unknown> = Promise.resolve.bind(Promise);
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;

export type IdentitySessionRefreshDiscoveryPrismaClient = Pick<PrismaClient, '$queryRaw'>;

type QueryRawOperation = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
type DiscoveryState = Readonly<{
  authority: IdentitySessionRefreshDiscoveryBoundaryAuthority;
  queryRaw: QueryRawOperation;
}>;
type ExactDiscoveryRows =
  typeof IDENTITY_SESSION_REFRESH_DISCOVERY_NO_ROW | Readonly<{ kind: 'found'; row: unknown }>;
type UnknownRecord = Readonly<Record<string, unknown>>;

const discoveryStates = new WeakMap<object, DiscoveryState>();

function persistenceFailed(): never {
  throw new IdentitySessionRefreshDiscoveryPersistenceError();
}

function unavailable(): never {
  throw new IdentitySessionRefreshDiscoveryUnavailableError();
}

function isDependencyReceiver(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !capturedIsArray(value);
}

function createQueryRawOperation(value: unknown): QueryRawOperation {
  if (!isDependencyReceiver(value)) {
    persistenceFailed();
  }

  const queryRaw: unknown = capturedReflectGet(value, '$queryRaw');

  if (typeof queryRaw !== 'function') {
    persistenceFailed();
  }

  return (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
    const result: unknown = capturedReflectApply(queryRaw, value, [strings, ...values]);

    return capturedPromiseResolve(result);
  };
}

function overwriteDigestBytes(value: Uint8Array<ArrayBuffer>): void {
  try {
    for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
      value[index] = 0;
    }

    for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
      if (value[index] !== 0) {
        persistenceFailed();
      }
    }
  } catch {
    persistenceFailed();
  }
}

function readExactDiscoveryRows(value: unknown): ExactDiscoveryRows {
  if (!capturedIsArray(value)) {
    persistenceFailed();
  }

  const keys = capturedOwnKeys(value);
  const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');

  if (
    lengthDescriptor === undefined ||
    !capturedHasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false
  ) {
    persistenceFailed();
  }

  const rowCount: unknown = (lengthDescriptor as Readonly<{ value: unknown }>).value;

  if (rowCount === 0) {
    if (keys.length !== 1 || keys[0] !== 'length') {
      persistenceFailed();
    }

    return IDENTITY_SESSION_REFRESH_DISCOVERY_NO_ROW;
  }

  if (
    rowCount !== 1 ||
    keys.length !== 2 ||
    !keys.some((key) => key === '0') ||
    !keys.some((key) => key === 'length')
  ) {
    persistenceFailed();
  }

  const rowDescriptor = capturedGetOwnPropertyDescriptor(value, '0');

  if (
    rowDescriptor === undefined ||
    !capturedHasOwn(rowDescriptor, 'value') ||
    rowDescriptor.enumerable !== true
  ) {
    persistenceFailed();
  }

  return {
    kind: 'found',
    row: (rowDescriptor as Readonly<{ value: unknown }>).value,
  };
}

function hasExactRowKeys(value: UnknownRecord): boolean {
  const keys = capturedOwnKeys(value);

  return (
    keys.length === IDENTITY_SESSION_REFRESH_DISCOVERY_ROW_KEYS.length &&
    keys.every(
      (key) =>
        typeof key === 'string' &&
        IDENTITY_SESSION_REFRESH_DISCOVERY_ROW_KEYS.some((expectedKey) => expectedKey === key),
    )
  );
}

function readDataProperty(value: UnknownRecord, property: string): unknown {
  const descriptor = capturedGetOwnPropertyDescriptor(value, property);

  if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
    persistenceFailed();
  }

  return (descriptor as Readonly<{ value: unknown }>).value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') {
    persistenceFailed();
  }

  return value;
}

function mapDiscoveryResult(
  authority: IdentitySessionRefreshDiscoveryBoundaryAuthority,
  refreshCredentialDigest: IdentityRefreshCredentialDigest,
  value: unknown,
): IdentitySessionRefreshDiscoveryResult {
  try {
    const rows = readExactDiscoveryRows(value);

    if (rows.kind === 'not-found') {
      return IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND;
    }

    const row = rows.row;

    if (typeof row !== 'object' || row === null || capturedIsArray(row)) {
      persistenceFailed();
    }

    const record = row as UnknownRecord;

    if (!hasExactRowKeys(record)) {
      persistenceFailed();
    }

    const refreshFamilyId = requiredString(readDataProperty(record, 'refresh_family_id'));
    const loadedSessionId = requiredString(readDataProperty(record, 'loaded_session_id'));
    const familyAccountId = requiredString(readDataProperty(record, 'family_account_id'));
    const loadedAccountId = requiredString(readDataProperty(record, 'loaded_account_id'));
    const presentedRefreshCredentialId = requiredString(
      readDataProperty(record, 'presented_refresh_credential_id'),
    );

    if (refreshFamilyId !== loadedSessionId || familyAccountId !== loadedAccountId) {
      persistenceFailed();
    }

    return createIdentitySessionRefreshDiscoveryFoundTicket(authority, refreshCredentialDigest, {
      accountId: familyAccountId,
      sessionId: refreshFamilyId,
      presentedRefreshCredentialId,
    });
  } catch {
    persistenceFailed();
  }
}

function translateQueryFailure(error: unknown): never {
  let databaseUnavailable = false;

  try {
    databaseUnavailable = isPrismaDatabaseUnavailableError(error);
  } catch {
    // A classifier defect is an internal persistence failure below.
  }

  if (databaseUnavailable) {
    unavailable();
  }

  persistenceFailed();
}

class PrismaIdentitySessionRefreshDiscoveryRuntime implements IdentitySessionRefreshDiscovery {
  public constructor(capability: object, state: DiscoveryState) {
    if (capability !== IDENTITY_SESSION_REFRESH_DISCOVERY_CONSTRUCTION_CAPABILITY) {
      persistenceFailed();
    }

    discoveryStates.set(this, state);
    capturedFreeze(this);
  }

  public async findByRefreshCredentialDigest(
    refreshCredentialDigest: IdentityRefreshCredentialDigest,
  ): Promise<IdentitySessionRefreshDiscoveryResult> {
    const state = discoveryStates.get(this);

    if (state === undefined) {
      persistenceFailed();
    }

    const digestBytes = copyIdentityRefreshCredentialDigestBytes(refreshCredentialDigest);
    let rawResult: unknown;

    try {
      rawResult = await state.queryRaw`
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
        WHERE refresh.digest = ${digestBytes}
        LIMIT ${IDENTITY_SESSION_REFRESH_DISCOVERY_OVERFLOW_PROBE_ROW_COUNT}
      `;
    } catch (error: unknown) {
      translateQueryFailure(error);
    } finally {
      overwriteDigestBytes(digestBytes);
    }

    return mapDiscoveryResult(state.authority, refreshCredentialDigest, rawResult);
  }
}

capturedFreeze(PrismaIdentitySessionRefreshDiscoveryRuntime.prototype);
capturedFreeze(PrismaIdentitySessionRefreshDiscoveryRuntime);

/** Creates one lifecycle-blind discovery from the writer client with a private pairing authority. */
export function createPrismaIdentitySessionRefreshDiscovery(
  client: IdentitySessionRefreshDiscoveryPrismaClient,
): IdentitySessionRefreshDiscovery {
  try {
    const state = capturedFreeze({
      authority: createIdentitySessionRefreshDiscoveryBoundaryAuthority(),
      queryRaw: createQueryRawOperation(client),
    });

    return new PrismaIdentitySessionRefreshDiscoveryRuntime(
      IDENTITY_SESSION_REFRESH_DISCOVERY_CONSTRUCTION_CAPABILITY,
      state,
    );
  } catch {
    persistenceFailed();
  }
}

/** @internal Recovers the private capability for the future paired locked loader. */
export function inspectPrismaIdentitySessionRefreshDiscoveryAuthority(
  discovery: unknown,
): IdentitySessionRefreshDiscoveryBoundaryAuthority {
  try {
    if (typeof discovery !== 'object' || discovery === null) {
      persistenceFailed();
    }

    const state = discoveryStates.get(discovery);

    if (state === undefined) {
      persistenceFailed();
    }

    return state.authority;
  } catch {
    persistenceFailed();
  }
}
