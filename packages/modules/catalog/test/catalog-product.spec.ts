import { InvalidCatalogNameError } from '../src/domain/catalog-name';
import {
  CatalogProductLifecycleConflictError,
  CatalogProductTimestampRegressionError,
  CatalogProductVersionMismatchError,
  InvalidCatalogProductStateError,
} from '../src/domain/catalog-product.errors';
import type {
  CatalogProductDomainEvent,
  CatalogProductMutationEvent,
} from '../src/domain/catalog-product.events';
import {
  CatalogProduct,
  type CatalogProductChangedResult,
  type CatalogProductSnapshot,
  type CreateCatalogProductInput,
} from '../src/domain/catalog-product';
import {
  InvalidCatalogProductIdError,
  type CatalogProductStatus,
} from '../src/domain/catalog-product.values';
import {
  CatalogAggregateVersionExhaustedError,
  InvalidCatalogAggregateVersionError,
  InvalidCatalogInstantError,
  InvalidCatalogLifecycleReasonCodeError,
  MAX_CATALOG_AGGREGATE_VERSION,
} from '../src/domain/catalog-values';

const PRODUCT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const PRODUCT_NAME = 'Whole milk';
const RENAMED_PRODUCT = 'Whole milk 1 litre';
const T0 = '2026-08-22T10:00:00.000001Z';
const T1 = '2026-08-22T10:01:00.000002Z';
const T2 = '2026-08-22T10:02:00.000003Z';
const T3 = '2026-08-22T10:03:00.000004Z';
const T4 = '2026-08-22T10:04:00.000005Z';
const BEFORE_T0 = '2026-08-22T09:59:59.999999Z';
const REASON_CODE = 'SAFETY_RECALL';

type RawProductSnapshot = Readonly<{
  id: unknown;
  name: unknown;
  status: unknown;
  version: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  statusChangedAt: unknown;
  activatedAt: unknown;
  archivedAt: unknown;
}>;

type LifecycleAction = 'activate' | 'suspend' | 'resume' | 'archive';

function draftSnapshot(overrides: Partial<RawProductSnapshot> = {}): RawProductSnapshot {
  return {
    id: PRODUCT_ID,
    name: PRODUCT_NAME,
    status: 'DRAFT',
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    statusChangedAt: T0,
    activatedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function activeSnapshot(overrides: Partial<RawProductSnapshot> = {}): RawProductSnapshot {
  return draftSnapshot({
    status: 'ACTIVE',
    version: 2,
    updatedAt: T1,
    statusChangedAt: T1,
    activatedAt: T1,
    ...overrides,
  });
}

function suspendedSnapshot(overrides: Partial<RawProductSnapshot> = {}): RawProductSnapshot {
  return activeSnapshot({
    status: 'SUSPENDED',
    version: 3,
    updatedAt: T2,
    statusChangedAt: T2,
    ...overrides,
  });
}

function archivedSnapshot(overrides: Partial<RawProductSnapshot> = {}): RawProductSnapshot {
  return activeSnapshot({
    status: 'ARCHIVED',
    version: 3,
    updatedAt: T2,
    statusChangedAt: T2,
    archivedAt: T2,
    ...overrides,
  });
}

function createProduct(): CatalogProduct {
  return CatalogProduct.create({ id: PRODUCT_ID, name: PRODUCT_NAME, occurredAt: T0 }).product;
}

function productInStatus(status: CatalogProductStatus): CatalogProduct {
  const draft = createProduct();

  switch (status) {
    case 'DRAFT':
      return draft;
    case 'ACTIVE':
      return draft.activate({ expectedVersion: 1, occurredAt: T1 }).product;
    case 'SUSPENDED': {
      const active = draft.activate({ expectedVersion: 1, occurredAt: T1 }).product;
      return active.suspend({
        expectedVersion: 2,
        occurredAt: T2,
        reasonCode: REASON_CODE,
      }).product;
    }
    case 'ARCHIVED':
      return draft.archive({
        expectedVersion: 1,
        occurredAt: T1,
        reasonCode: REASON_CODE,
      }).product;
  }
}

function performLifecycle(
  product: CatalogProduct,
  action: LifecycleAction,
  occurredAt: unknown = T4,
  expectedVersion: unknown = product.toSnapshot().version,
): CatalogProductChangedResult<CatalogProductMutationEvent> {
  switch (action) {
    case 'activate':
      return product.activate({ expectedVersion, occurredAt });
    case 'suspend':
      return product.suspend({ expectedVersion, occurredAt, reasonCode: REASON_CODE });
    case 'resume':
      return product.resume({ expectedVersion, occurredAt });
    case 'archive':
      return product.archive({ expectedVersion, occurredAt, reasonCode: REASON_CODE });
  }
}

function expectedLifecycleEvent(
  action: LifecycleAction,
  before: CatalogProductSnapshot,
  after: CatalogProductSnapshot,
): CatalogProductDomainEvent {
  const common = {
    productId: after.id,
    name: after.name,
    version: after.version,
    occurredAt: after.updatedAt,
  };

  switch (action) {
    case 'activate':
      return {
        ...common,
        type: 'PRODUCT_ACTIVATED',
        previousStatus: 'DRAFT',
        status: 'ACTIVE',
      };
    case 'suspend':
      return {
        ...common,
        type: 'PRODUCT_SUSPENDED',
        previousStatus: 'ACTIVE',
        status: 'SUSPENDED',
        reasonCode: REASON_CODE,
      };
    case 'resume':
      return {
        ...common,
        type: 'PRODUCT_RESUMED',
        previousStatus: 'SUSPENDED',
        status: 'ACTIVE',
      };
    case 'archive':
      return {
        ...common,
        type: 'PRODUCT_ARCHIVED',
        previousStatus: before.status as Exclude<CatalogProductStatus, 'ARCHIVED'>,
        status: 'ARCHIVED',
        reasonCode: REASON_CODE,
      };
  }
}

describe('CatalogProduct creation and rehydration', (): void => {
  it('creates the exact initial Draft state and one internal event', (): void => {
    const result = CatalogProduct.create({ id: PRODUCT_ID, name: PRODUCT_NAME, occurredAt: T0 });

    expect(result).toEqual({
      kind: 'changed',
      product: result.product,
      event: {
        type: 'PRODUCT_CREATED',
        productId: PRODUCT_ID,
        name: PRODUCT_NAME,
        status: 'DRAFT',
        version: 1,
        occurredAt: T0,
      },
    });
    expect(result.product.toSnapshot()).toEqual(draftSnapshot());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.product)).toBe(true);
    expect(Object.isFrozen(result.event)).toBe(true);
    expect(Object.isFrozen(result.product.toSnapshot())).toBe(true);
  });

  it('copies caller values into immutable state without retaining its object', (): void => {
    const input = { id: PRODUCT_ID, name: PRODUCT_NAME, occurredAt: T0 };
    const product = CatalogProduct.create(input).product;
    input.name = 'Changed outside the aggregate';

    expect(product.toSnapshot().name).toBe(PRODUCT_NAME);
    expect(() => {
      (product.toSnapshot() as { name: string }).name = 'Runtime mutation';
    }).toThrow(TypeError);
    expect(product.toSnapshot().name).toBe(PRODUCT_NAME);
  });

  it.each([
    [
      'missing identifier',
      { id: undefined, name: PRODUCT_NAME, occurredAt: T0 },
      InvalidCatalogProductIdError,
    ],
    [
      'malformed identifier',
      { id: 'not-a-product-id', name: PRODUCT_NAME, occurredAt: T0 },
      InvalidCatalogProductIdError,
    ],
    ['missing name', { id: PRODUCT_ID, name: undefined, occurredAt: T0 }, InvalidCatalogNameError],
    [
      'malformed name',
      { id: PRODUCT_ID, name: ' invalid', occurredAt: T0 },
      InvalidCatalogNameError,
    ],
    [
      'missing occurrence time',
      { id: PRODUCT_ID, name: PRODUCT_NAME, occurredAt: undefined },
      InvalidCatalogInstantError,
    ],
    [
      'malformed occurrence time',
      { id: PRODUCT_ID, name: PRODUCT_NAME, occurredAt: 'not-an-instant' },
      InvalidCatalogInstantError,
    ],
  ] as const)(
    'rejects factory input with a %s before returning state or an event',
    (_scenario, input, expectedError): void => {
      let result: ReturnType<typeof CatalogProduct.create> | null = null;

      expect(() => {
        result = CatalogProduct.create(input satisfies CreateCatalogProductInput);
      }).toThrow(expectedError);
      expect(result).toBeNull();
    },
  );

  it.each([
    ['Draft after a rename', draftSnapshot({ version: 2, updatedAt: T1 })],
    ['first-active Product', activeSnapshot()],
    ['resumed active Product', activeSnapshot({ version: 4, updatedAt: T3, statusChangedAt: T3 })],
    ['suspended Product', suspendedSnapshot()],
    [
      'Product archived directly from Draft',
      draftSnapshot({
        status: 'ARCHIVED',
        version: 2,
        updatedAt: T1,
        statusChangedAt: T1,
        archivedAt: T1,
      }),
    ],
    ['previously activated archived Product', archivedSnapshot()],
  ])('rehydrates a valid %s without creating an event', (_scenario, snapshot): void => {
    const product = CatalogProduct.rehydrate(snapshot);

    expect(product.toSnapshot()).toEqual(snapshot);
    expect(Object.isFrozen(product)).toBe(true);
    expect(Object.isFrozen(product.toSnapshot())).toBe(true);
    expect(Object.keys(product)).toEqual([]);
  });

  it('does not retain a mutable rehydration object', (): void => {
    const snapshot = { ...activeSnapshot() };
    const product = CatalogProduct.rehydrate(snapshot);
    snapshot.name = 'Changed persistence record';

    expect(product.toSnapshot().name).toBe(PRODUCT_NAME);
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing required member', { id: PRODUCT_ID }],
    ['additional member', { ...draftSnapshot(), internal: 'value' }],
    ['invalid id', draftSnapshot({ id: 'persistence-product-id' })],
    ['invalid name', draftSnapshot({ name: ' invalid' })],
    ['invalid status', draftSnapshot({ status: 'RETIRED' })],
    ['invalid version', draftSnapshot({ version: 0 })],
    ['invalid creation instant', draftSnapshot({ createdAt: 'not-an-instant' })],
    ['updated before creation', draftSnapshot({ updatedAt: BEFORE_T0 })],
    ['status changed before creation', draftSnapshot({ statusChangedAt: BEFORE_T0 })],
    ['status changed after update', activeSnapshot({ statusChangedAt: T2 })],
    ['activation before creation', activeSnapshot({ activatedAt: BEFORE_T0 })],
    ['activation after update', activeSnapshot({ activatedAt: T2 })],
    ['Draft with activation', draftSnapshot({ activatedAt: T0 })],
    ['Draft with archive', draftSnapshot({ archivedAt: T0 })],
    ['Draft with changed lifecycle time', draftSnapshot({ statusChangedAt: T1, updatedAt: T1 })],
    ['initial Draft with a later update', draftSnapshot({ updatedAt: T1 })],
    ['Active without activation', activeSnapshot({ activatedAt: null })],
    ['Active at unreachable version 1', activeSnapshot({ version: 1 })],
    ['first Active with a later update', activeSnapshot({ updatedAt: T2 })],
    [
      'resumed Active lifecycle time at unreachable version 3',
      activeSnapshot({ version: 3, updatedAt: T2, statusChangedAt: T2 }),
    ],
    ['Active with archive', activeSnapshot({ archivedAt: T1 })],
    [
      'Active status change before activation',
      activeSnapshot({ activatedAt: T2, updatedAt: T2, statusChangedAt: T1 }),
    ],
    ['Suspended without activation', suspendedSnapshot({ activatedAt: null })],
    ['Suspended at unreachable version 2', suspendedSnapshot({ version: 2 })],
    ['first Suspended with a later update', suspendedSnapshot({ updatedAt: T3 })],
    ['Suspended with archive', suspendedSnapshot({ archivedAt: T2 })],
    ['Archived without archive time', archivedSnapshot({ archivedAt: null })],
    ['Archived with mismatched status time', archivedSnapshot({ statusChangedAt: T1 })],
    ['Archived with later update', archivedSnapshot({ updatedAt: T3 })],
    [
      'directly archived Product at unreachable version 1',
      draftSnapshot({
        status: 'ARCHIVED',
        version: 1,
        updatedAt: T1,
        statusChangedAt: T1,
        archivedAt: T1,
      }),
    ],
    ['activated archived Product at unreachable version 2', archivedSnapshot({ version: 2 })],
    [
      'Archive before first activation',
      archivedSnapshot({ activatedAt: T3, archivedAt: T2, statusChangedAt: T2, updatedAt: T3 }),
    ],
  ])('rejects a corrupt %s with one fixed cause-free error', (_scenario, snapshot): void => {
    let error: unknown;

    try {
      CatalogProduct.rehydrate(snapshot);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidCatalogProductStateError);
    expect(String(error)).toBe(
      'InvalidCatalogProductStateError: Expected a valid Catalog Product snapshot',
    );
    expect(JSON.stringify(error)).not.toContain('persistence-product-id');
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe('CatalogProduct rename', (): void => {
  it.each(['DRAFT', 'ACTIVE', 'SUSPENDED'] as const)(
    'renames a %s Product while preserving lifecycle metadata',
    (status): void => {
      const product = productInStatus(status);
      const before = product.toSnapshot();
      const result = product.rename({
        name: RENAMED_PRODUCT,
        expectedVersion: before.version,
        occurredAt: T4,
      });

      expect(result.kind).toBe('changed');
      if (result.kind !== 'changed') {
        throw new Error('Expected a changed rename result');
      }

      expect(result.product.toSnapshot()).toEqual({
        ...before,
        name: RENAMED_PRODUCT,
        version: before.version + 1,
        updatedAt: T4,
      });
      expect(result.event).toEqual({
        type: 'PRODUCT_RENAMED',
        productId: PRODUCT_ID,
        previousName: PRODUCT_NAME,
        name: RENAMED_PRODUCT,
        status,
        version: before.version + 1,
        occurredAt: T4,
      });
      expect(CatalogProduct.rehydrate(result.product.toSnapshot()).toSnapshot()).toEqual(
        result.product.toSnapshot(),
      );
      expect(product.toSnapshot()).toBe(before);
      expect(Object.isFrozen(result.event)).toBe(true);
    },
  );

  it.each(['DRAFT', 'ACTIVE', 'SUSPENDED'] as const)(
    'returns an event-free, clock-free no-op for a same-name %s Product',
    (status): void => {
      const product = productInStatus(status);
      const before = product.toSnapshot();
      const result = product.rename({
        name: PRODUCT_NAME,
        expectedVersion: before.version,
        occurredAt: 'not-inspected-for-a-no-op',
      });

      expect(result).toEqual({ kind: 'unchanged', product });
      expect(result.product).toBe(product);
      expect(result.product.toSnapshot()).toBe(before);
      expect('event' in result).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it('checks the expected version before accepting a same-name no-op', (): void => {
    const product = createProduct();

    expect(() =>
      product.rename({ name: PRODUCT_NAME, expectedVersion: 2, occurredAt: T1 }),
    ).toThrow(CatalogProductVersionMismatchError);
  });

  it('rejects a same-name Archived Product as a lifecycle conflict', (): void => {
    const product = productInStatus('ARCHIVED');
    const before = product.toSnapshot();

    expect(() =>
      product.rename({
        name: PRODUCT_NAME,
        expectedVersion: before.version,
        occurredAt: T4,
      }),
    ).toThrow(CatalogProductLifecycleConflictError);
    expect(product.toSnapshot()).toBe(before);
  });

  it('rejects an invalid name without mutating the Product', (): void => {
    const product = createProduct();
    const before = product.toSnapshot();

    expect(() => product.rename({ name: ' invalid', expectedVersion: 1, occurredAt: T1 })).toThrow(
      InvalidCatalogNameError,
    );
    expect(product.toSnapshot()).toBe(before);
  });
});

describe('CatalogProduct lifecycle', (): void => {
  it.each([
    ['DRAFT', 'activate', 'ACTIVE'],
    ['DRAFT', 'archive', 'ARCHIVED'],
    ['ACTIVE', 'suspend', 'SUSPENDED'],
    ['ACTIVE', 'archive', 'ARCHIVED'],
    ['SUSPENDED', 'resume', 'ACTIVE'],
    ['SUSPENDED', 'archive', 'ARCHIVED'],
  ] as const)(
    'applies the allowed %s -> %s transition',
    (sourceStatus, action, resultingStatus): void => {
      const product = productInStatus(sourceStatus);
      const before = product.toSnapshot();
      const result = performLifecycle(product, action);
      const after = result.product.toSnapshot();

      expect(after).toEqual({
        ...before,
        status: resultingStatus,
        version: before.version + 1,
        updatedAt: T4,
        statusChangedAt: T4,
        activatedAt: action === 'activate' ? T4 : before.activatedAt,
        archivedAt: action === 'archive' ? T4 : before.archivedAt,
      });
      expect(result.event).toEqual(expectedLifecycleEvent(action, before, after));
      expect(CatalogProduct.rehydrate(after).toSnapshot()).toEqual(after);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.event)).toBe(true);
      expect(product.toSnapshot()).toBe(before);
    },
  );

  it.each([
    ['DRAFT', 'suspend'],
    ['DRAFT', 'resume'],
    ['ACTIVE', 'activate'],
    ['ACTIVE', 'resume'],
    ['SUSPENDED', 'activate'],
    ['SUSPENDED', 'suspend'],
    ['ARCHIVED', 'activate'],
    ['ARCHIVED', 'suspend'],
    ['ARCHIVED', 'resume'],
    ['ARCHIVED', 'archive'],
  ] as const)('rejects the forbidden %s -> %s operation atomically', (status, action): void => {
    const product = productInStatus(status);
    const before = product.toSnapshot();

    expect(() => performLifecycle(product, action)).toThrow(CatalogProductLifecycleConflictError);
    expect(product.toSnapshot()).toBe(before);
  });

  it('preserves first activation across suspend and resume', (): void => {
    const active = productInStatus('ACTIVE');
    const activatedAt = active.toSnapshot().activatedAt;
    const suspended = active.suspend({
      expectedVersion: 2,
      occurredAt: T2,
      reasonCode: REASON_CODE,
    }).product;
    const resumed = suspended.resume({ expectedVersion: 3, occurredAt: T3 }).product;

    expect(suspended.toSnapshot().activatedAt).toBe(activatedAt);
    expect(resumed.toSnapshot().activatedAt).toBe(activatedAt);
    expect(resumed.toSnapshot().statusChangedAt).toBe(T3);
  });

  it('accepts an equal microsecond mutation time because version orders changes', (): void => {
    const active = productInStatus('ACTIVE');
    const result = active.suspend({
      expectedVersion: 2,
      occurredAt: T1,
      reasonCode: REASON_CODE,
    });

    expect(result.product.toSnapshot()).toMatchObject({
      status: 'SUSPENDED',
      version: 3,
      updatedAt: T1,
      statusChangedAt: T1,
    });
  });

  it.each([
    [
      'rename',
      (product: CatalogProduct): unknown =>
        product.rename({ name: RENAMED_PRODUCT, expectedVersion: 2, occurredAt: T1 }),
    ],
    [
      'activate',
      (product: CatalogProduct): unknown =>
        product.activate({ expectedVersion: 2, occurredAt: T1 }),
    ],
    [
      'archive',
      (product: CatalogProduct): unknown =>
        product.archive({ expectedVersion: 2, occurredAt: T1, reasonCode: REASON_CODE }),
    ],
  ] as const)('rejects stale expected version before the %s operation', (_action, invoke): void => {
    const product = createProduct();
    const before = product.toSnapshot();

    expect(() => invoke(product)).toThrow(CatalogProductVersionMismatchError);
    expect(product.toSnapshot()).toBe(before);
  });

  it.each([
    [
      'suspend',
      productInStatus('ACTIVE'),
      (product: CatalogProduct): unknown =>
        product.suspend({ expectedVersion: 3, occurredAt: T2, reasonCode: REASON_CODE }),
    ],
    [
      'resume',
      productInStatus('SUSPENDED'),
      (product: CatalogProduct): unknown => product.resume({ expectedVersion: 4, occurredAt: T3 }),
    ],
  ] as const)('rejects stale expected version before %s', (_action, product, invoke): void => {
    const before = product.toSnapshot();

    expect(() => invoke(product)).toThrow(CatalogProductVersionMismatchError);
    expect(product.toSnapshot()).toBe(before);
  });

  it('rejects an invalid expected version category without exposing state', (): void => {
    const product = createProduct();

    expect(() => product.activate({ expectedVersion: 0, occurredAt: T1 })).toThrow(
      InvalidCatalogAggregateVersionError,
    );
  });

  it.each([
    [
      'rename',
      productInStatus('DRAFT'),
      (product: CatalogProduct): unknown =>
        product.rename({ name: RENAMED_PRODUCT, expectedVersion: 1, occurredAt: BEFORE_T0 }),
    ],
    [
      'activate',
      productInStatus('DRAFT'),
      (product: CatalogProduct): unknown =>
        product.activate({ expectedVersion: 1, occurredAt: BEFORE_T0 }),
    ],
    [
      'suspend',
      productInStatus('ACTIVE'),
      (product: CatalogProduct): unknown =>
        product.suspend({
          expectedVersion: 2,
          occurredAt: BEFORE_T0,
          reasonCode: REASON_CODE,
        }),
    ],
    [
      'resume',
      productInStatus('SUSPENDED'),
      (product: CatalogProduct): unknown =>
        product.resume({ expectedVersion: 3, occurredAt: BEFORE_T0 }),
    ],
    [
      'archive',
      productInStatus('DRAFT'),
      (product: CatalogProduct): unknown =>
        product.archive({
          expectedVersion: 1,
          occurredAt: BEFORE_T0,
          reasonCode: REASON_CODE,
        }),
    ],
  ] as const)(
    'rejects timestamp regression for %s without mutation',
    (_action, product, invoke): void => {
      const before = product.toSnapshot();

      expect(() => invoke(product)).toThrow(CatalogProductTimestampRegressionError);
      expect(product.toSnapshot()).toBe(before);
    },
  );

  it('rejects malformed mutation time and lifecycle reason without mutation', (): void => {
    const active = productInStatus('ACTIVE');
    const before = active.toSnapshot();

    expect(() =>
      active.suspend({ expectedVersion: 2, occurredAt: 'invalid-time', reasonCode: REASON_CODE }),
    ).toThrow(InvalidCatalogInstantError);
    expect(() =>
      active.suspend({ expectedVersion: 2, occurredAt: T2, reasonCode: 'CUSTOM_REASON' }),
    ).toThrow(InvalidCatalogLifecycleReasonCodeError);
    expect(active.toSnapshot()).toBe(before);
  });
});

describe('CatalogProduct version exhaustion and safe errors', (): void => {
  it('allows a same-value no-op at maximum version without inspecting the clock', (): void => {
    const product = CatalogProduct.rehydrate(
      draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
    );
    const result = product.rename({
      name: PRODUCT_NAME,
      expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
      occurredAt: 'not-a-clock-value',
    });

    expect(result).toEqual({ kind: 'unchanged', product });
  });

  it.each([
    [
      'rename',
      draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (product: CatalogProduct): unknown =>
        product.rename({
          name: RENAMED_PRODUCT,
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
        }),
    ],
    [
      'activate',
      draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (product: CatalogProduct): unknown =>
        product.activate({
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
        }),
    ],
    [
      'suspend',
      activeSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (product: CatalogProduct): unknown =>
        product.suspend({
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
          reasonCode: REASON_CODE,
        }),
    ],
    [
      'resume',
      suspendedSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (product: CatalogProduct): unknown =>
        product.resume({
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
        }),
    ],
    [
      'archive',
      draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (product: CatalogProduct): unknown =>
        product.archive({
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
          reasonCode: REASON_CODE,
        }),
    ],
  ] as const)('rejects version exhaustion for an actual %s', (_action, snapshot, invoke): void => {
    const product = CatalogProduct.rehydrate(snapshot);
    const before = product.toSnapshot();

    expect(() => invoke(product)).toThrow(CatalogAggregateVersionExhaustedError);
    expect(product.toSnapshot()).toBe(before);
  });

  it('keeps lifecycle conflicts free of current state and submitted values', (): void => {
    const product = productInStatus('ARCHIVED');
    const error = (() => {
      try {
        product.archive({
          expectedVersion: product.toSnapshot().version,
          occurredAt: T4,
          reasonCode: REASON_CODE,
        });
      } catch (caught: unknown) {
        return caught;
      }

      return null;
    })();

    expect(error).toBeInstanceOf(CatalogProductLifecycleConflictError);
    expect(String(error)).not.toContain('ARCHIVED');
    expect(String(error)).not.toContain(REASON_CODE);
    expect(JSON.stringify(error)).not.toContain(PRODUCT_ID);
  });
});
