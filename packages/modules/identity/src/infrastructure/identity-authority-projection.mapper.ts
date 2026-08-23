import { isProxy } from 'node:util/types';

import {
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT,
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT,
} from '../application/identity-authenticated-principal';
import { InvalidIdentityAuthenticatedPrincipalError } from '../application/identity-authenticated-principal.errors';
import { parseIdentityAccountId, type IdentityAccountId } from '../domain/identity-account.values';
import {
  parseIdentityPermissionCode,
  type IdentityPermissionCode,
} from '../domain/identity-permission.values';
import { parseIdentityRoleId, type IdentityRoleId } from '../domain/identity-role.values';
import {
  parseIdentitySessionId,
  type IdentitySessionId,
} from '../domain/identity-session-family.values';

const AUTHORITY_STATE_CORRUPT = 'CORRUPT';
const AUTHORITY_STATE_REJECTED = 'REJECTED';
const AUTHORITY_STATE_RESOLVED = 'RESOLVED';
const MAX_IDENTITY_AUTHORITY_RAW_MAPPING_ROWS =
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT *
  MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT;
const AUTHORITY_ROW_KEYS = Object.freeze([
  'authority_state',
  'actor_id',
  'session_id',
  'assigned_role_id',
  'loaded_role_id',
  'role_status',
  'mapped_permission_code',
  'permission_code',
] as const);
const arrayPrototype = Array.prototype;
const objectPrototype = Object.prototype;
const capturedArrayIsArray = Array.isArray;
const capturedArraySort = Array.prototype.sort;
const capturedDefineProperty = Object.defineProperty;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsInteger = Number.isInteger;
const capturedIsProxy = isProxy;
const CapturedMap = Map;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedMapGet = Map.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedMapHas = Map.prototype.has;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedMapSet = Map.prototype.set;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const CapturedSet = Set;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetAdd = Set.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetHas = Set.prototype.has;

type AuthorityState =
  | typeof AUTHORITY_STATE_CORRUPT
  | typeof AUTHORITY_STATE_REJECTED
  | typeof AUTHORITY_STATE_RESOLVED;
type RoleStatus = 'ACTIVE' | 'RETIRED';
type ActiveRoleProjectionKind = 'empty' | 'mapped';
type AuthorityRow = Readonly<Record<(typeof AUTHORITY_ROW_KEYS)[number], unknown>>;
type OwnDataPropertyDescriptor = Omit<PropertyDescriptor, 'get' | 'set' | 'value'> &
  Readonly<{ value: unknown }>;

export type IdentityAuthorityProjection = Readonly<{
  actorId: IdentityAccountId;
  sessionId: IdentitySessionId;
  activeRoleCount: number;
  permissions: readonly IdentityPermissionCode[];
}>;

export type IdentityAuthorityProjectionResult =
  | Readonly<{ kind: 'rejected' }>
  | Readonly<{ kind: 'resolved'; projection: IdentityAuthorityProjection }>;

const REJECTED: IdentityAuthorityProjectionResult = capturedFreeze({ kind: 'rejected' });

function invalidAuthority(): never {
  throw new InvalidIdentityAuthenticatedPrincipalError();
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isOwnDataProperty(
  descriptor: PropertyDescriptor | undefined,
  enumerable: boolean,
): descriptor is OwnDataPropertyDescriptor {
  return (
    descriptor !== undefined &&
    capturedHasOwn(descriptor, 'value') &&
    descriptor.enumerable === enumerable
  );
}

function hasExactAuthorityRowKeys(keys: readonly PropertyKey[]): boolean {
  if (keys.length !== AUTHORITY_ROW_KEYS.length) return false;

  // Indexing avoids granting mutable iterator authority at the provider boundary.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];

    if (typeof key !== 'string') return false;
    let matched = false;

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let expectedIndex = 0; expectedIndex < AUTHORITY_ROW_KEYS.length; expectedIndex += 1) {
      if (key === AUTHORITY_ROW_KEYS[expectedIndex]) {
        matched = true;
        break;
      }
    }

    if (!matched) return false;
  }

  return true;
}

function readAuthorityRow(value: unknown): AuthorityRow {
  if (
    !isObject(value) ||
    capturedIsProxy(value) ||
    capturedArrayIsArray(value) ||
    capturedGetPrototypeOf(value) !== objectPrototype ||
    !hasExactAuthorityRowKeys(capturedOwnKeys(value))
  ) {
    invalidAuthority();
  }

  const row = {} as Record<(typeof AUTHORITY_ROW_KEYS)[number], unknown>;

  // The provider record is read through descriptors only; accessors never run.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let index = 0; index < AUTHORITY_ROW_KEYS.length; index += 1) {
    const key = AUTHORITY_ROW_KEYS[index];

    if (key === undefined) invalidAuthority();
    const descriptor = capturedGetOwnPropertyDescriptor(value, key);

    if (!isOwnDataProperty(descriptor, true)) invalidAuthority();
    capturedDefineProperty(row, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }

  return capturedFreeze(row);
}

function readRows(value: unknown): readonly AuthorityRow[] {
  if (
    !isObject(value) ||
    capturedIsProxy(value) ||
    !capturedArrayIsArray(value) ||
    capturedGetPrototypeOf(value) !== arrayPrototype
  ) {
    invalidAuthority();
  }

  const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');

  if (!isOwnDataProperty(lengthDescriptor, false)) invalidAuthority();
  const rowCount = lengthDescriptor.value;

  if (
    typeof rowCount !== 'number' ||
    !capturedIsInteger(rowCount) ||
    rowCount < 0 ||
    rowCount > MAX_IDENTITY_AUTHORITY_RAW_MAPPING_ROWS ||
    capturedOwnKeys(value).length !== rowCount + 1
  ) {
    invalidAuthority();
  }

  const rows: AuthorityRow[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const descriptor = capturedGetOwnPropertyDescriptor(value, index);

    if (!isOwnDataProperty(descriptor, true)) invalidAuthority();
    capturedDefineProperty(rows, index, {
      configurable: true,
      enumerable: true,
      value: readAuthorityRow(descriptor.value),
      writable: true,
    });
  }

  return capturedFreeze(rows);
}

function readAuthorityState(row: AuthorityRow): AuthorityState {
  const state = row.authority_state;

  if (
    state !== AUTHORITY_STATE_CORRUPT &&
    state !== AUTHORITY_STATE_REJECTED &&
    state !== AUTHORITY_STATE_RESOLVED
  ) {
    invalidAuthority();
  }

  return state;
}

function isNullProjection(row: AuthorityRow): boolean {
  return (
    row.actor_id === null &&
    row.session_id === null &&
    row.assigned_role_id === null &&
    row.loaded_role_id === null &&
    row.role_status === null &&
    row.mapped_permission_code === null &&
    row.permission_code === null
  );
}

function compareAscii(left: IdentityPermissionCode, right: IdentityPermissionCode): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function mapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  return capturedReflectApply(capturedMapGet, map, [key]) as Value | undefined;
}

function mapHas<Key, Value>(map: Map<Key, Value>, key: Key): boolean {
  return capturedReflectApply(capturedMapHas, map, [key]);
}

function mapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  capturedReflectApply(capturedMapSet, map, [key, value]);
}

function setHas<Value>(set: Set<Value>, value: Value): boolean {
  return capturedReflectApply(capturedSetHas, set, [value]);
}

function setAdd<Value>(set: Set<Value>, value: Value): void {
  capturedReflectApply(capturedSetAdd, set, [value]);
}

function mapResolvedRows(rows: readonly AuthorityRow[]): IdentityAuthorityProjectionResult {
  const firstRow = rows[0];

  if (firstRow === undefined) invalidAuthority();
  const actorId = parseIdentityAccountId(firstRow.actor_id);
  const sessionId = parseIdentitySessionId(firstRow.session_id);
  const roleStatuses = new CapturedMap<IdentityRoleId, RoleStatus>();
  const activeRoleProjectionKinds = new CapturedMap<IdentityRoleId, ActiveRoleProjectionKind>();
  const activeRoleIds = new CapturedSet<IdentityRoleId>();
  const permissionCodes = new CapturedSet<IdentityPermissionCode>();
  const rolePermissionPairs = new CapturedSet<string>();
  const orderedPermissionCodes: IdentityPermissionCode[] = [];
  let activeRoleCount = 0;
  let permissionCount = 0;
  let hasNullRoleProjection = false;

  // Indexing avoids depending on a mutable Array iterator in this authority boundary.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (
      row === undefined ||
      readAuthorityState(row) !== AUTHORITY_STATE_RESOLVED ||
      row.actor_id !== actorId ||
      row.session_id !== sessionId
    ) {
      invalidAuthority();
    }

    const rawAssignedRoleId = row.assigned_role_id;
    const rawLoadedRoleId = row.loaded_role_id;
    const rawRoleStatus = row.role_status;
    const rawMappedPermissionCode = row.mapped_permission_code;
    const rawPermissionCode = row.permission_code;

    if (rawAssignedRoleId === null) {
      if (
        rawLoadedRoleId !== null ||
        rawRoleStatus !== null ||
        rawMappedPermissionCode !== null ||
        rawPermissionCode !== null ||
        rows.length !== 1
      ) {
        invalidAuthority();
      }

      hasNullRoleProjection = true;
      continue;
    }

    if (hasNullRoleProjection) invalidAuthority();
    const roleId = parseIdentityRoleId(rawAssignedRoleId);

    if (rawLoadedRoleId !== roleId) invalidAuthority();
    if (rawRoleStatus !== 'ACTIVE' && rawRoleStatus !== 'RETIRED') invalidAuthority();
    const priorRoleStatus = mapGet(roleStatuses, roleId);

    if (priorRoleStatus !== undefined && priorRoleStatus !== rawRoleStatus) invalidAuthority();

    if (rawRoleStatus === 'RETIRED') {
      if (
        priorRoleStatus !== undefined ||
        rawMappedPermissionCode !== null ||
        rawPermissionCode !== null
      ) {
        invalidAuthority();
      }

      mapSet(roleStatuses, roleId, rawRoleStatus);
      continue;
    }

    mapSet(roleStatuses, roleId, rawRoleStatus);

    if (!setHas(activeRoleIds, roleId)) {
      setAdd(activeRoleIds, roleId);
      activeRoleCount += 1;

      if (activeRoleCount > MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_ACTIVE_ROLE_COUNT) {
        invalidAuthority();
      }
    }

    if (rawMappedPermissionCode === null) {
      if (rawPermissionCode !== null || mapHas(activeRoleProjectionKinds, roleId)) {
        invalidAuthority();
      }

      mapSet(activeRoleProjectionKinds, roleId, 'empty');
      const emptyRolePair = `${roleId}\u0000`;

      if (setHas(rolePermissionPairs, emptyRolePair)) invalidAuthority();
      setAdd(rolePermissionPairs, emptyRolePair);
      continue;
    }

    const mappedPermissionCode = parseIdentityPermissionCode(rawMappedPermissionCode);

    if (mapGet(activeRoleProjectionKinds, roleId) === 'empty') invalidAuthority();
    mapSet(activeRoleProjectionKinds, roleId, 'mapped');

    if (rawPermissionCode !== mappedPermissionCode) invalidAuthority();
    const permissionCode = parseIdentityPermissionCode(rawPermissionCode);
    const pair = `${roleId}\u0000${permissionCode}`;

    if (setHas(rolePermissionPairs, pair)) invalidAuthority();
    setAdd(rolePermissionPairs, pair);

    if (!setHas(permissionCodes, permissionCode)) {
      setAdd(permissionCodes, permissionCode);
      capturedDefineProperty(orderedPermissionCodes, permissionCount, {
        configurable: true,
        enumerable: true,
        value: permissionCode,
        writable: true,
      });
      permissionCount += 1;

      if (permissionCount > MAX_IDENTITY_AUTHENTICATED_PRINCIPAL_PERMISSION_COUNT) {
        invalidAuthority();
      }
    }
  }

  capturedReflectApply(capturedArraySort, orderedPermissionCodes, [compareAscii]);
  const projection: IdentityAuthorityProjection = capturedFreeze({
    actorId,
    sessionId,
    activeRoleCount,
    permissions: capturedFreeze(orderedPermissionCodes),
  });

  return capturedFreeze({ kind: 'resolved', projection });
}

/** Maps one exact bounded provider projection without constructing a principal. */
export function mapIdentityAuthorityProjectionRows(
  value: unknown,
): IdentityAuthorityProjectionResult {
  try {
    const rows = readRows(value);
    const firstRow = rows[0];

    if (firstRow === undefined) return REJECTED;
    const state = readAuthorityState(firstRow);

    if (state === AUTHORITY_STATE_REJECTED) {
      if (rows.length !== 1 || !isNullProjection(firstRow)) invalidAuthority();
      return REJECTED;
    }

    if (state !== AUTHORITY_STATE_RESOLVED) invalidAuthority();
    return mapResolvedRows(rows);
  } catch {
    invalidAuthority();
  }
}
