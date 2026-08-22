import { parseCatalogName, type CatalogName } from './catalog-name';
import {
  CatalogProductLifecycleConflictError,
  CatalogProductTimestampRegressionError,
  CatalogProductVersionMismatchError,
  InvalidCatalogProductStateError,
} from './catalog-product.errors';
import type {
  CatalogProductActivatedEvent,
  CatalogProductArchivedEvent,
  CatalogProductCreatedEvent,
  CatalogProductDomainEvent,
  CatalogProductMutationEvent,
  CatalogProductRenamedEvent,
  CatalogProductResumedEvent,
  CatalogProductSuspendedEvent,
} from './catalog-product.events';
import {
  parseCatalogProductId,
  parseCatalogProductStatus,
  type CatalogProductId,
  type CatalogProductStatus,
} from './catalog-product.values';
import {
  compareCatalogInstants,
  nextCatalogAggregateVersion,
  parseCatalogAggregateVersion,
  parseCatalogInstant,
  parseCatalogLifecycleReasonCode,
  type CatalogAggregateVersion,
  type CatalogInstant,
} from './catalog-values';

const CATALOG_PRODUCT_SNAPSHOT_KEYS = Object.freeze([
  'id',
  'name',
  'status',
  'version',
  'createdAt',
  'updatedAt',
  'statusChangedAt',
  'activatedAt',
  'archivedAt',
] as const);

export type CatalogProductSnapshot = Readonly<{
  id: CatalogProductId;
  name: CatalogName;
  status: CatalogProductStatus;
  version: CatalogAggregateVersion;
  createdAt: CatalogInstant;
  updatedAt: CatalogInstant;
  statusChangedAt: CatalogInstant;
  activatedAt: CatalogInstant | null;
  archivedAt: CatalogInstant | null;
}>;

export type CreateCatalogProductInput = Readonly<{
  id: unknown;
  name: unknown;
  occurredAt: unknown;
}>;

export type RenameCatalogProductInput = Readonly<{
  name: unknown;
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type TransitionCatalogProductInput = Readonly<{
  expectedVersion: unknown;
  occurredAt: unknown;
}>;

export type ReasonedCatalogProductTransitionInput = TransitionCatalogProductInput &
  Readonly<{
    reasonCode: unknown;
  }>;

export type CatalogProductChangedResult<
  Event extends CatalogProductDomainEvent = CatalogProductDomainEvent,
> = Readonly<{
  kind: 'changed';
  product: CatalogProduct;
  event: Event;
}>;

export type CatalogProductUnchangedResult = Readonly<{
  kind: 'unchanged';
  product: CatalogProduct;
}>;

export type CatalogProductMutationResult<
  Event extends CatalogProductMutationEvent = CatalogProductMutationEvent,
> = CatalogProductChangedResult<Event> | CatalogProductUnchangedResult;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactSnapshotKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === CATALOG_PRODUCT_SNAPSHOT_KEYS.length &&
    keys.every((key) => CATALOG_PRODUCT_SNAPSHOT_KEYS.some((expected) => expected === key))
  );
}

function parseNullableCatalogInstant(value: unknown): CatalogInstant | null {
  return value === null ? null : parseCatalogInstant(value);
}

function freezeSnapshot(snapshot: CatalogProductSnapshot): CatalogProductSnapshot {
  return Object.freeze({ ...snapshot });
}

function invalidSnapshot(): never {
  throw new InvalidCatalogProductStateError();
}

function assertSnapshotChronology(snapshot: CatalogProductSnapshot): void {
  if (
    compareCatalogInstants(snapshot.createdAt, snapshot.statusChangedAt) > 0 ||
    compareCatalogInstants(snapshot.statusChangedAt, snapshot.updatedAt) > 0 ||
    (snapshot.activatedAt !== null &&
      (compareCatalogInstants(snapshot.createdAt, snapshot.activatedAt) > 0 ||
        compareCatalogInstants(snapshot.activatedAt, snapshot.updatedAt) > 0)) ||
    (snapshot.archivedAt !== null &&
      (compareCatalogInstants(snapshot.createdAt, snapshot.archivedAt) > 0 ||
        compareCatalogInstants(snapshot.archivedAt, snapshot.updatedAt) > 0))
  ) {
    invalidSnapshot();
  }
}

function assertSnapshotLifecycle(snapshot: CatalogProductSnapshot): void {
  switch (snapshot.status) {
    case 'DRAFT':
      if (
        snapshot.activatedAt !== null ||
        snapshot.archivedAt !== null ||
        snapshot.statusChangedAt !== snapshot.createdAt
      ) {
        invalidSnapshot();
      }
      return;
    case 'ACTIVE': {
      const minimumVersion = snapshot.activatedAt === snapshot.statusChangedAt ? 2 : 4;
      if (
        snapshot.activatedAt === null ||
        snapshot.archivedAt !== null ||
        compareCatalogInstants(snapshot.activatedAt, snapshot.statusChangedAt) > 0 ||
        snapshot.version < minimumVersion
      ) {
        invalidSnapshot();
      }
      return;
    }
    case 'SUSPENDED':
      if (
        snapshot.activatedAt === null ||
        snapshot.archivedAt !== null ||
        compareCatalogInstants(snapshot.activatedAt, snapshot.statusChangedAt) > 0 ||
        snapshot.version < 3
      ) {
        invalidSnapshot();
      }
      return;
    case 'ARCHIVED': {
      if (
        snapshot.archivedAt === null ||
        snapshot.archivedAt !== snapshot.statusChangedAt ||
        snapshot.archivedAt !== snapshot.updatedAt
      ) {
        invalidSnapshot();
      }

      const earliestArchive = snapshot.activatedAt ?? snapshot.createdAt;
      const minimumVersion = snapshot.activatedAt === null ? 2 : 3;
      if (
        compareCatalogInstants(earliestArchive, snapshot.archivedAt) > 0 ||
        snapshot.version < minimumVersion
      ) {
        invalidSnapshot();
      }
    }
  }
}

function parseSnapshot(value: unknown): CatalogProductSnapshot {
  if (!isRecord(value) || !hasExactSnapshotKeys(value)) {
    invalidSnapshot();
  }

  const snapshot = freezeSnapshot({
    id: parseCatalogProductId(value['id']),
    name: parseCatalogName(value['name']),
    status: parseCatalogProductStatus(value['status']),
    version: parseCatalogAggregateVersion(value['version']),
    createdAt: parseCatalogInstant(value['createdAt']),
    updatedAt: parseCatalogInstant(value['updatedAt']),
    statusChangedAt: parseCatalogInstant(value['statusChangedAt']),
    activatedAt: parseNullableCatalogInstant(value['activatedAt']),
    archivedAt: parseNullableCatalogInstant(value['archivedAt']),
  });

  assertSnapshotChronology(snapshot);
  assertSnapshotLifecycle(snapshot);

  return snapshot;
}

function changed<Event extends CatalogProductDomainEvent>(
  product: CatalogProduct,
  event: Event,
): CatalogProductChangedResult<Event> {
  return Object.freeze({ kind: 'changed', product, event: Object.freeze(event) });
}

function unchanged(product: CatalogProduct): CatalogProductUnchangedResult {
  return Object.freeze({ kind: 'unchanged', product });
}

/** Framework-free Product aggregate. Every mutation returns a new immutable value. */
export class CatalogProduct {
  readonly #snapshot: CatalogProductSnapshot;

  private constructor(snapshot: CatalogProductSnapshot) {
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  public static create(
    input: CreateCatalogProductInput,
  ): CatalogProductChangedResult<CatalogProductCreatedEvent> {
    const occurredAt = parseCatalogInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      id: parseCatalogProductId(input.id),
      name: parseCatalogName(input.name),
      status: 'DRAFT',
      version: parseCatalogAggregateVersion(1),
      createdAt: occurredAt,
      updatedAt: occurredAt,
      statusChangedAt: occurredAt,
      activatedAt: null,
      archivedAt: null,
    });
    const product = new CatalogProduct(snapshot);

    return changed(product, {
      type: 'PRODUCT_CREATED',
      productId: snapshot.id,
      name: snapshot.name,
      status: 'DRAFT',
      version: snapshot.version,
      occurredAt,
    });
  }

  /** Rebuilds authoritative state without replaying historical domain events. */
  public static rehydrate(value: unknown): CatalogProduct {
    try {
      return new CatalogProduct(parseSnapshot(value));
    } catch {
      throw new InvalidCatalogProductStateError();
    }
  }

  public toSnapshot(): CatalogProductSnapshot {
    return this.#snapshot;
  }

  public rename(
    input: RenameCatalogProductInput,
  ): CatalogProductMutationResult<CatalogProductRenamedEvent> {
    this.assertExpectedVersion(input.expectedVersion);
    const status = this.nonArchivedStatus();
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
    const product = new CatalogProduct(snapshot);

    return changed(product, {
      type: 'PRODUCT_RENAMED',
      productId: snapshot.id,
      previousName: this.#snapshot.name,
      name: snapshot.name,
      status,
      version: snapshot.version,
      occurredAt,
    });
  }

  public activate(
    input: TransitionCatalogProductInput,
  ): CatalogProductChangedResult<CatalogProductActivatedEvent> {
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
    const product = new CatalogProduct(snapshot);

    return changed(product, {
      type: 'PRODUCT_ACTIVATED',
      productId: snapshot.id,
      name: snapshot.name,
      previousStatus: 'DRAFT',
      status: 'ACTIVE',
      version: snapshot.version,
      occurredAt,
    });
  }

  public suspend(
    input: ReasonedCatalogProductTransitionInput,
  ): CatalogProductChangedResult<CatalogProductSuspendedEvent> {
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
    const product = new CatalogProduct(snapshot);

    return changed(product, {
      type: 'PRODUCT_SUSPENDED',
      productId: snapshot.id,
      name: snapshot.name,
      previousStatus: 'ACTIVE',
      status: 'SUSPENDED',
      version: snapshot.version,
      occurredAt,
      reasonCode,
    });
  }

  public resume(
    input: TransitionCatalogProductInput,
  ): CatalogProductChangedResult<CatalogProductResumedEvent> {
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
    const product = new CatalogProduct(snapshot);

    return changed(product, {
      type: 'PRODUCT_RESUMED',
      productId: snapshot.id,
      name: snapshot.name,
      previousStatus: 'SUSPENDED',
      status: 'ACTIVE',
      version: snapshot.version,
      occurredAt,
    });
  }

  public archive(
    input: ReasonedCatalogProductTransitionInput,
  ): CatalogProductChangedResult<CatalogProductArchivedEvent> {
    this.assertExpectedVersion(input.expectedVersion);
    const previousStatus = this.nonArchivedStatus();
    const reasonCode = parseCatalogLifecycleReasonCode(input.reasonCode);
    const occurredAt = this.mutationInstant(input.occurredAt);
    const snapshot = freezeSnapshot({
      ...this.#snapshot,
      status: 'ARCHIVED',
      version: nextCatalogAggregateVersion(this.#snapshot.version),
      updatedAt: occurredAt,
      statusChangedAt: occurredAt,
      archivedAt: occurredAt,
    });
    const product = new CatalogProduct(snapshot);

    return changed(product, {
      type: 'PRODUCT_ARCHIVED',
      productId: snapshot.id,
      name: snapshot.name,
      previousStatus,
      status: 'ARCHIVED',
      version: snapshot.version,
      occurredAt,
      reasonCode,
    });
  }

  private assertExpectedVersion(value: unknown): void {
    const expectedVersion = parseCatalogAggregateVersion(value);

    if (expectedVersion !== this.#snapshot.version) {
      throw new CatalogProductVersionMismatchError();
    }
  }

  private assertStatus(required: CatalogProductStatus): void {
    if (this.#snapshot.status !== required) {
      throw new CatalogProductLifecycleConflictError();
    }
  }

  private nonArchivedStatus(): Exclude<CatalogProductStatus, 'ARCHIVED'> {
    if (this.#snapshot.status === 'ARCHIVED') {
      throw new CatalogProductLifecycleConflictError();
    }

    return this.#snapshot.status;
  }

  private mutationInstant(value: unknown): CatalogInstant {
    const occurredAt = parseCatalogInstant(value);

    if (compareCatalogInstants(occurredAt, this.#snapshot.updatedAt) < 0) {
      throw new CatalogProductTimestampRegressionError();
    }

    return occurredAt;
  }
}
