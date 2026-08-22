import { parseCatalogName, type CatalogName } from './catalog-name';
import { parseCatalogProductId, type CatalogProductId } from './catalog-product.values';
import {
  CatalogSkuLifecycleConflictError,
  CatalogSkuTimestampRegressionError,
  CatalogSkuVersionMismatchError,
  InvalidCatalogSkuStateError,
} from './catalog-sku.errors';
import type {
  CatalogSkuActivatedEvent,
  CatalogSkuCreatedEvent,
  CatalogSkuDomainEvent,
  CatalogSkuMutationEvent,
  CatalogSkuRenamedEvent,
  CatalogSkuResumedEvent,
  CatalogSkuRetiredEvent,
  CatalogSkuSuspendedEvent,
} from './catalog-sku.events';
import {
  parseCatalogSkuCode,
  parseCatalogSkuId,
  parseCatalogSkuStatus,
  type CatalogSkuCode,
  type CatalogSkuId,
  type CatalogSkuStatus,
} from './catalog-sku.values';
import {
  compareCatalogInstants,
  nextCatalogAggregateVersion,
  parseCatalogAggregateVersion,
  parseCatalogInstant,
  parseCatalogLifecycleReasonCode,
  type CatalogAggregateVersion,
  type CatalogInstant,
} from './catalog-values';

const CATALOG_SKU_SNAPSHOT_KEYS = Object.freeze([
  'id',
  'productId',
  'code',
  'name',
  'status',
  'version',
  'createdAt',
  'updatedAt',
  'statusChangedAt',
  'activatedAt',
  'retiredAt',
] as const);

export type CatalogSkuSnapshot = Readonly<{
  id: CatalogSkuId;
  productId: CatalogProductId;
  code: CatalogSkuCode;
  name: CatalogName;
  status: CatalogSkuStatus;
  version: CatalogAggregateVersion;
  createdAt: CatalogInstant;
  updatedAt: CatalogInstant;
  statusChangedAt: CatalogInstant;
  activatedAt: CatalogInstant | null;
  retiredAt: CatalogInstant | null;
}>;

export type CreateCatalogSkuInput = Readonly<{
  id: unknown;
  productId: unknown;
  code: unknown;
  name: unknown;
  occurredAt: unknown;
}>;

export type RenameCatalogSkuInput = Readonly<{
  name: unknown;
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type TransitionCatalogSkuInput = Readonly<{
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type ReasonedCatalogSkuTransitionInput = TransitionCatalogSkuInput &
  Readonly<{
    reasonCode: unknown;
  }>;

export type CatalogSkuChangedResult<Event extends CatalogSkuDomainEvent = CatalogSkuDomainEvent> =
  Readonly<{
    kind: 'changed';
    sku: CatalogSku;
    event: Event;
  }>;

export type CatalogSkuUnchangedResult = Readonly<{
  kind: 'unchanged';
  sku: CatalogSku;
}>;

export type CatalogSkuMutationResult<
  Event extends CatalogSkuMutationEvent = CatalogSkuMutationEvent,
> = CatalogSkuChangedResult<Event> | CatalogSkuUnchangedResult;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactSnapshotKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === CATALOG_SKU_SNAPSHOT_KEYS.length &&
    keys.every((key) => CATALOG_SKU_SNAPSHOT_KEYS.some((expected) => expected === key))
  );
}

function parseNullableCatalogInstant(value: unknown): CatalogInstant | null {
  return value === null ? null : parseCatalogInstant(value);
}

function freezeSnapshot(snapshot: CatalogSkuSnapshot): CatalogSkuSnapshot {
  return Object.freeze({ ...snapshot });
}

function invalidSnapshot(): never {
  throw new InvalidCatalogSkuStateError();
}

function assertSnapshotChronology(snapshot: CatalogSkuSnapshot): void {
  if (
    compareCatalogInstants(snapshot.createdAt, snapshot.statusChangedAt) > 0 ||
    compareCatalogInstants(snapshot.statusChangedAt, snapshot.updatedAt) > 0 ||
    (snapshot.activatedAt !== null &&
      (compareCatalogInstants(snapshot.createdAt, snapshot.activatedAt) > 0 ||
        compareCatalogInstants(snapshot.activatedAt, snapshot.updatedAt) > 0)) ||
    (snapshot.retiredAt !== null &&
      (compareCatalogInstants(snapshot.createdAt, snapshot.retiredAt) > 0 ||
        compareCatalogInstants(snapshot.retiredAt, snapshot.updatedAt) > 0))
  ) {
    invalidSnapshot();
  }
}

function assertSnapshotLifecycle(snapshot: CatalogSkuSnapshot): void {
  switch (snapshot.status) {
    case 'DRAFT':
      if (
        snapshot.activatedAt !== null ||
        snapshot.retiredAt !== null ||
        snapshot.statusChangedAt !== snapshot.createdAt ||
        (snapshot.version === 1 && snapshot.updatedAt !== snapshot.createdAt)
      ) {
        invalidSnapshot();
      }
      return;
    case 'ACTIVE': {
      const minimumVersion = snapshot.activatedAt === snapshot.statusChangedAt ? 2 : 4;
      if (
        snapshot.activatedAt === null ||
        snapshot.retiredAt !== null ||
        compareCatalogInstants(snapshot.activatedAt, snapshot.statusChangedAt) > 0 ||
        snapshot.version < minimumVersion ||
        (snapshot.version === minimumVersion && snapshot.updatedAt !== snapshot.statusChangedAt)
      ) {
        invalidSnapshot();
      }
      return;
    }
    case 'SUSPENDED':
      if (
        snapshot.activatedAt === null ||
        snapshot.retiredAt !== null ||
        compareCatalogInstants(snapshot.activatedAt, snapshot.statusChangedAt) > 0 ||
        snapshot.version < 3 ||
        (snapshot.version === 3 && snapshot.updatedAt !== snapshot.statusChangedAt)
      ) {
        invalidSnapshot();
      }
      return;
    case 'RETIRED': {
      if (
        snapshot.retiredAt === null ||
        snapshot.retiredAt !== snapshot.statusChangedAt ||
        snapshot.retiredAt !== snapshot.updatedAt
      ) {
        invalidSnapshot();
      }

      const earliestRetirement = snapshot.activatedAt ?? snapshot.createdAt;
      const minimumVersion = snapshot.activatedAt === null ? 2 : 3;
      if (
        compareCatalogInstants(earliestRetirement, snapshot.retiredAt) > 0 ||
        snapshot.version < minimumVersion
      ) {
        invalidSnapshot();
      }
    }
  }
}

function parseSnapshot(value: unknown): CatalogSkuSnapshot {
  if (!isRecord(value) || !hasExactSnapshotKeys(value)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    id: parseCatalogSkuId(value['id']),
    productId: parseCatalogProductId(value['productId']),
    code: parseCatalogSkuCode(value['code']),
    name: parseCatalogName(value['name']),
    status: parseCatalogSkuStatus(value['status']),
    version: parseCatalogAggregateVersion(value['version']),
    createdAt: parseCatalogInstant(value['createdAt']),
    updatedAt: parseCatalogInstant(value['updatedAt']),
    statusChangedAt: parseCatalogInstant(value['statusChangedAt']),
    activatedAt: parseNullableCatalogInstant(value['activatedAt']),
    retiredAt: parseNullableCatalogInstant(value['retiredAt']),
  });

  assertSnapshotChronology(snapshot);
  assertSnapshotLifecycle(snapshot);

  return snapshot;
}

function changed<Event extends CatalogSkuDomainEvent>(
  sku: CatalogSku,
  event: Event,
): CatalogSkuChangedResult<Event> {
  return Object.freeze({ kind: 'changed', sku, event: Object.freeze(event) });
}

function unchanged(sku: CatalogSku): CatalogSkuUnchangedResult {
  return Object.freeze({ kind: 'unchanged', sku });
}

/** Framework-free SKU aggregate. Cross-root Product policy belongs to the application Unit of Work. */
export class CatalogSku {
  readonly #snapshot: CatalogSkuSnapshot;

  private constructor(snapshot: CatalogSkuSnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  /** Must be called only after the application layer verifies that the owning Product is nonterminal. */
  public static create(
    input: CreateCatalogSkuInput,
  ): CatalogSkuChangedResult<CatalogSkuCreatedEvent> {
    const occurredAt = parseCatalogInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      id: parseCatalogSkuId(input.id),
      productId: parseCatalogProductId(input.productId),
      code: parseCatalogSkuCode(input.code),
      name: parseCatalogName(input.name),
      status: 'DRAFT',
      version: parseCatalogAggregateVersion(1),
      createdAt: occurredAt,
      updatedAt: occurredAt,
      statusChangedAt: occurredAt,
      activatedAt: null,
      retiredAt: null,
    });
    const sku = new CatalogSku(snapshot);

    return changed(sku, {
      type: 'SKU_CREATED',
      skuId: snapshot.id,
      productId: snapshot.productId,
      code: snapshot.code,
      name: snapshot.name,
      status: 'DRAFT',
      version: snapshot.version,
      occurredAt,
    });
  }

  /** Rebuilds authoritative state without replaying historical domain events. */
  public static rehydrate(value: unknown): CatalogSku {
    try {
      return new CatalogSku(parseSnapshot(value));
    } catch {
      throw new InvalidCatalogSkuStateError();
    }
  }

  public toSnapshot(): CatalogSkuSnapshot {
    return this.#snapshot;
  }

  public rename(input: RenameCatalogSkuInput): CatalogSkuMutationResult<CatalogSkuRenamedEvent> {
    this.assertExpectedVersion(input.expectedVersion);
    const status = this.nonRetiredStatus();
    const name = parseCatalogName(input.name);

    if (name === this.#snapshot.name) {
      return unchanged(this);
    }

    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      name,
      version: nextCatalogAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
    });
    const sku = new CatalogSku(snapshot);

    return changed(sku, {
      type: 'SKU_RENAMED',
      skuId: snapshot.id,
      productId: snapshot.productId,
      code: snapshot.code,
      previousName: this.#snapshot.name,
      name: snapshot.name,
      status,
      version: snapshot.version,
      occurredAt,
    });
  }

  /** The application layer must transactionally verify that the owning Product is not Archived. */
  public activate(
    input: TransitionCatalogSkuInput,
  ): CatalogSkuChangedResult<CatalogSkuActivatedEvent> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertStatus('DRAFT');
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'ACTIVE',
      version: nextCatalogAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      statusChangedAt: occurredAt,
      activatedAt: occurredAt,
    });
    const sku = new CatalogSku(snapshot);

    return changed(sku, {
      type: 'SKU_ACTIVATED',
      skuId: snapshot.id,
      productId: snapshot.productId,
      code: snapshot.code,
      name: snapshot.name,
      previousStatus: 'DRAFT',
      status: 'ACTIVE',
      version: snapshot.version,
      occurredAt,
    });
  }

  public suspend(
    input: ReasonedCatalogSkuTransitionInput,
  ): CatalogSkuChangedResult<CatalogSkuSuspendedEvent> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertStatus('ACTIVE');
    const reasonCode = parseCatalogLifecycleReasonCode(input.reasonCode);
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'SUSPENDED',
      version: nextCatalogAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      statusChangedAt: occurredAt,
    });
    const sku = new CatalogSku(snapshot);

    return changed(sku, {
      type: 'SKU_SUSPENDED',
      skuId: snapshot.id,
      productId: snapshot.productId,
      code: snapshot.code,
      name: snapshot.name,
      previousStatus: 'ACTIVE',
      status: 'SUSPENDED',
      version: snapshot.version,
      occurredAt,
      reasonCode,
    });
  }

  /** The application layer must transactionally verify that the owning Product is not Archived. */
  public resume(input: TransitionCatalogSkuInput): CatalogSkuChangedResult<CatalogSkuResumedEvent> {
    this.assertExpectedVersion(input.expectedVersion);
    this.assertStatus('SUSPENDED');
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'ACTIVE',
      version: nextCatalogAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      statusChangedAt: occurredAt,
    });
    const sku = new CatalogSku(snapshot);

    return changed(sku, {
      type: 'SKU_RESUMED',
      skuId: snapshot.id,
      productId: snapshot.productId,
      code: snapshot.code,
      name: snapshot.name,
      previousStatus: 'SUSPENDED',
      status: 'ACTIVE',
      version: snapshot.version,
      occurredAt,
    });
  }

  public retire(
    input: ReasonedCatalogSkuTransitionInput,
  ): CatalogSkuChangedResult<CatalogSkuRetiredEvent> {
    this.assertExpectedVersion(input.expectedVersion);
    const previousStatus = this.nonRetiredStatus();
    const reasonCode = parseCatalogLifecycleReasonCode(input.reasonCode);
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'RETIRED',
      version: nextCatalogAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      statusChangedAt: occurredAt,
      retiredAt: occurredAt,
    });
    const sku = new CatalogSku(snapshot);

    return changed(sku, {
      type: 'SKU_RETIRED',
      skuId: snapshot.id,
      productId: snapshot.productId,
      code: snapshot.code,
      name: snapshot.name,
      previousStatus,
      status: 'RETIRED',
      version: snapshot.version,
      occurredAt,
      reasonCode,
    });
  }

  private assertExpectedVersion(value: unknown): void {
    const expectedVersion = parseCatalogAggregateVersion(value);

    if (expectedVersion !== this.#snapshot.version) {
      throw new CatalogSkuVersionMismatchError();
    }
  }

  private assertStatus(required: CatalogSkuStatus): void {
    if (this.#snapshot.status !== required) {
      throw new CatalogSkuLifecycleConflictError();
    }
  }

  private nonRetiredStatus(): Exclude<CatalogSkuStatus, 'RETIRED'> {
    if (this.#snapshot.status === 'RETIRED') {
      throw new CatalogSkuLifecycleConflictError();
    }

    return this.#snapshot.status;
  }

  private mutationInstant(value: unknown): CatalogInstant {
    const occurredAt = parseCatalogInstant(value);

    if (compareCatalogInstants(occurredAt, this.#snapshot.updatedAt) < 0) {
      throw new CatalogSkuTimestampRegressionError();
    }

    return occurredAt;
  }
}
