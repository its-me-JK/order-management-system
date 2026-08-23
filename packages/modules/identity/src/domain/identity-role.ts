import {
  IdentityRoleLifecycleConflictError,
  IdentityRolePermissionCapacityExceededError,
  IdentityRoleTimestampRegressionError,
  IdentityRoleVersionMismatchError,
  InvalidIdentityRolePermissionSetError,
  InvalidIdentityRoleStateError,
} from './identity-role.errors';
import type {
  IdentityRoleCreationFacts,
  IdentityRoleFactTuple,
  IdentityRolePermissionGrantedFact,
  IdentityRolePermissionGrantedFacts,
  IdentityRolePermissionRevokedFacts,
  IdentityRoleRenamedFacts,
  IdentityRoleRetiredFacts,
} from './identity-role.facts';
import {
  MAX_IDENTITY_ROLE_PERMISSIONS,
  parseIdentityPermissionCode,
  type IdentityPermissionCode,
} from './identity-permission.values';
import {
  parseIdentityRoleCode,
  parseIdentityRoleDisplayName,
  parseIdentityRoleId,
  parseIdentityRoleStatus,
  type IdentityRoleCode,
  type IdentityRoleDisplayName,
  type IdentityRoleId,
  type IdentityRoleStatus,
} from './identity-role.values';
import {
  compareIdentityInstants,
  nextIdentityAggregateVersion,
  parseIdentityAggregateVersion,
  parseIdentityInstant,
  type IdentityAggregateVersion,
  type IdentityInstant,
} from './identity-values';

const IDENTITY_ROLE_SNAPSHOT_KEYS = Object.freeze([
  'id',
  'code',
  'displayName',
  'status',
  'permissions',
  'version',
  'createdAt',
  'updatedAt',
  'retiredAt',
] as const);
const EMPTY_IDENTITY_ROLE_FACTS: readonly [] = Object.freeze([]);

export type IdentityRoleSnapshot = Readonly<{
  id: IdentityRoleId;
  code: IdentityRoleCode;
  displayName: IdentityRoleDisplayName;
  status: IdentityRoleStatus;
  permissions: readonly IdentityPermissionCode[];
  version: IdentityAggregateVersion;
  createdAt: IdentityInstant;
  updatedAt: IdentityInstant;
  retiredAt: IdentityInstant | null;
}>;

export type CreateIdentityRoleInput = Readonly<{
  id: unknown;
  code: unknown;
  displayName: unknown;
  permissions: unknown;
  occurredAt: unknown;
}>;

export type RenameIdentityRoleInput = Readonly<{
  displayName: unknown;
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type ChangeIdentityRolePermissionInput = Readonly<{
  permissionCode: unknown;
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type RetireIdentityRoleInput = Readonly<{
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type IdentityRoleChangedResult<Facts extends IdentityRoleFactTuple = IdentityRoleFactTuple> =
  Readonly<{
    kind: 'changed';
    role: IdentityRole;
    facts: Facts;
  }>;

export type IdentityRoleUnchangedResult = Readonly<{
  kind: 'unchanged';
  role: IdentityRole;
  facts: readonly [];
}>;

export type IdentityRoleMutationResult<Facts extends IdentityRoleFactTuple> =
  IdentityRoleChangedResult<Facts> | IdentityRoleUnchangedResult;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactSnapshotKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === IDENTITY_ROLE_SNAPSHOT_KEYS.length &&
    keys.every((key) => IDENTITY_ROLE_SNAPSHOT_KEYS.some((expected) => expected === key))
  );
}

function comparePermissionCodes(
  left: IdentityPermissionCode,
  right: IdentityPermissionCode,
): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function invalidPermissionSet(): never {
  throw new InvalidIdentityRolePermissionSetError();
}

function parsePermissionSet(
  value: unknown,
  requireCanonicalOrder: boolean,
): readonly IdentityPermissionCode[] {
  if (!Array.isArray(value)) {
    invalidPermissionSet();
  }

  const permissionCount = value.length;

  if (permissionCount > MAX_IDENTITY_ROLE_PERMISSIONS) {
    throw new IdentityRolePermissionCapacityExceededError();
  }

  const permissions: IdentityPermissionCode[] = [];
  const seen = new Set<IdentityPermissionCode>();

  for (let index = 0; index < permissionCount; index += 1) {
    if (!Object.hasOwn(value, index)) {
      invalidPermissionSet();
    }

    const permissionCode = parseIdentityPermissionCode(value[index]);

    if (seen.has(permissionCode)) {
      invalidPermissionSet();
    }

    seen.add(permissionCode);
    permissions.push(permissionCode);
  }

  if (value.length !== permissionCount) {
    invalidPermissionSet();
  }

  if (requireCanonicalOrder) {
    for (let index = 1; index < permissions.length; index += 1) {
      const previous = permissions[index - 1];
      const current = permissions[index];

      if (
        previous === undefined ||
        current === undefined ||
        comparePermissionCodes(previous, current) >= 0
      ) {
        invalidPermissionSet();
      }
    }
  } else {
    permissions.sort(comparePermissionCodes);
  }

  return Object.freeze(permissions);
}

function parseNullableIdentityInstant(value: unknown): IdentityInstant | null {
  return value === null ? null : parseIdentityInstant(value);
}

function freezeSnapshot(snapshot: IdentityRoleSnapshot): IdentityRoleSnapshot {
  return Object.freeze({
    ...snapshot,
    permissions: Object.freeze([...snapshot.permissions]),
  });
}

function invalidSnapshot(): never {
  throw new InvalidIdentityRoleStateError();
}

function assertSnapshotState(snapshot: IdentityRoleSnapshot): void {
  if (compareIdentityInstants(snapshot.createdAt, snapshot.updatedAt) > 0) {
    invalidSnapshot();
  }

  switch (snapshot.status) {
    case 'ACTIVE':
      if (
        snapshot.retiredAt !== null ||
        (snapshot.version === 1 && snapshot.updatedAt !== snapshot.createdAt)
      ) {
        invalidSnapshot();
      }
      return;
    case 'RETIRED':
      if (
        snapshot.version < 2 ||
        snapshot.retiredAt === null ||
        snapshot.retiredAt !== snapshot.updatedAt
      ) {
        invalidSnapshot();
      }
  }
}

function parseSnapshot(value: unknown): IdentityRoleSnapshot {
  if (!isRecord(value) || !hasExactSnapshotKeys(value)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    id: parseIdentityRoleId(value['id']),
    code: parseIdentityRoleCode(value['code']),
    displayName: parseIdentityRoleDisplayName(value['displayName']),
    status: parseIdentityRoleStatus(value['status']),
    permissions: parsePermissionSet(value['permissions'], true),
    version: parseIdentityAggregateVersion(value['version']),
    createdAt: parseIdentityInstant(value['createdAt']),
    updatedAt: parseIdentityInstant(value['updatedAt']),
    retiredAt: parseNullableIdentityInstant(value['retiredAt']),
  });

  assertSnapshotState(snapshot);

  return snapshot;
}

function freezeFacts<Facts extends IdentityRoleFactTuple>(facts: Facts): Facts {
  return Object.freeze(facts.map((fact) => Object.freeze(fact))) as unknown as Facts;
}

function changed<Facts extends IdentityRoleFactTuple>(
  role: IdentityRole,
  facts: Facts,
): IdentityRoleChangedResult<Facts> {
  return Object.freeze({ kind: 'changed', role, facts: freezeFacts(facts) });
}

function unchanged(role: IdentityRole): IdentityRoleUnchangedResult {
  return Object.freeze({ kind: 'unchanged', role, facts: EMPTY_IDENTITY_ROLE_FACTS });
}

/** Framework-free Role aggregate. Permission existence is checked by the application Unit of Work. */
export class IdentityRole {
  readonly #snapshot: IdentityRoleSnapshot;

  private constructor(snapshot: IdentityRoleSnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  public static create(
    input: CreateIdentityRoleInput,
  ): IdentityRoleChangedResult<IdentityRoleCreationFacts> {
    const occurredAt = parseIdentityInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      id: parseIdentityRoleId(input.id),
      code: parseIdentityRoleCode(input.code),
      displayName: parseIdentityRoleDisplayName(input.displayName),
      status: 'ACTIVE',
      permissions: parsePermissionSet(input.permissions, false),
      version: parseIdentityAggregateVersion(1),
      createdAt: occurredAt,
      updatedAt: occurredAt,
      retiredAt: null,
    });
    const role = new IdentityRole(snapshot);
    const permissionFacts: IdentityRolePermissionGrantedFact[] = snapshot.permissions.map(
      (permissionCode) => ({
        type: 'ROLE_PERMISSION_GRANTED',
        roleId: snapshot.id,
        permissionCode,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      }),
    );
    const facts: IdentityRoleCreationFacts = [
      {
        type: 'ROLE_CREATED',
        roleId: snapshot.id,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      },
      ...permissionFacts,
    ];

    return changed(role, facts);
  }

  /** Rebuilds authoritative state without replaying historical domain facts. */
  public static rehydrate(value: unknown): IdentityRole {
    try {
      return new IdentityRole(parseSnapshot(value));
    } catch {
      throw new InvalidIdentityRoleStateError();
    }
  }

  public toSnapshot(): IdentityRoleSnapshot {
    return this.#snapshot;
  }

  public rename(
    input: RenameIdentityRoleInput,
  ): IdentityRoleMutationResult<IdentityRoleRenamedFacts> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertActive();
    const displayName = parseIdentityRoleDisplayName(input.displayName);

    if (displayName === this.#snapshot.displayName) {
      return unchanged(this);
    }

    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      displayName,
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
    });
    const role = new IdentityRole(snapshot);
    const facts: IdentityRoleRenamedFacts = [
      {
        type: 'ROLE_RENAMED',
        roleId: snapshot.id,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      },
    ];

    return changed(role, facts);
  }

  public grantPermission(
    input: ChangeIdentityRolePermissionInput,
  ): IdentityRoleMutationResult<IdentityRolePermissionGrantedFacts> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertActive();
    const permissionCode = parseIdentityPermissionCode(input.permissionCode);

    if (this.#snapshot.permissions.includes(permissionCode)) {
      return unchanged(this);
    }

    const occurredAt = this.mutationInstant(input.occurredAt);

    if (this.#snapshot.permissions.length === MAX_IDENTITY_ROLE_PERMISSIONS) {
      throw new IdentityRolePermissionCapacityExceededError();
    }

    const permissions = [...this.#snapshot.permissions, permissionCode].sort(
      comparePermissionCodes,
    );
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      permissions,
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
    });
    const role = new IdentityRole(snapshot);
    const facts: IdentityRolePermissionGrantedFacts = [
      {
        type: 'ROLE_PERMISSION_GRANTED',
        roleId: snapshot.id,
        permissionCode,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      },
    ];

    return changed(role, facts);
  }

  public revokePermission(
    input: ChangeIdentityRolePermissionInput,
  ): IdentityRoleMutationResult<IdentityRolePermissionRevokedFacts> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertActive();
    const permissionCode = parseIdentityPermissionCode(input.permissionCode);

    if (!this.#snapshot.permissions.includes(permissionCode)) {
      return unchanged(this);
    }

    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      permissions: this.#snapshot.permissions.filter(
        (currentPermission) => currentPermission !== permissionCode,
      ),
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
    });
    const role = new IdentityRole(snapshot);
    const facts: IdentityRolePermissionRevokedFacts = [
      {
        type: 'ROLE_PERMISSION_REVOKED',
        roleId: snapshot.id,
        permissionCode,
        status: 'ACTIVE',
        version: snapshot.version,
        occurredAt,
      },
    ];

    return changed(role, facts);
  }

  public retire(
    input: RetireIdentityRoleInput,
  ): IdentityRoleChangedResult<IdentityRoleRetiredFacts> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertActive();
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'RETIRED',
      version: nextIdentityAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      retiredAt: occurredAt,
    });
    const role = new IdentityRole(snapshot);
    const facts: IdentityRoleRetiredFacts = [
      {
        type: 'ROLE_RETIRED',
        roleId: snapshot.id,
        previousStatus: 'ACTIVE',
        status: 'RETIRED',
        version: snapshot.version,
        occurredAt,
      },
    ];

    return changed(role, facts);
  }

  private assertExpectedVersion(value: unknown): void {
    const expectedVersion = parseIdentityAggregateVersion(value);

    if (expectedVersion !== this.#snapshot.version) {
      throw new IdentityRoleVersionMismatchError();
    }
  }

  private assertActive(): void {
    if (this.#snapshot.status !== 'ACTIVE') {
      throw new IdentityRoleLifecycleConflictError();
    }
  }

  private mutationInstant(value: unknown): IdentityInstant {
    const occurredAt = parseIdentityInstant(value);

    if (compareIdentityInstants(occurredAt, this.#snapshot.updatedAt) < 0) {
      throw new IdentityRoleTimestampRegressionError();
    }

    return occurredAt;
  }
}
