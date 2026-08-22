import { InvalidCatalogNameError } from '../src/domain/catalog-name';
import { InvalidCatalogProductIdError } from '../src/domain/catalog-product.values';
import {
  CatalogSkuLifecycleConflictError,
  CatalogSkuTimestampRegressionError,
  CatalogSkuVersionMismatchError,
  InvalidCatalogSkuStateError,
} from '../src/domain/catalog-sku.errors';
import type {
  CatalogSkuDomainEvent,
  CatalogSkuMutationEvent,
} from '../src/domain/catalog-sku.events';
import {
  CatalogSku,
  type CatalogSkuChangedResult,
  type CatalogSkuSnapshot,
  type CreateCatalogSkuInput,
} from '../src/domain/catalog-sku';
import {
  InvalidCatalogSkuCodeError,
  InvalidCatalogSkuIdError,
  type CatalogSkuStatus,
} from '../src/domain/catalog-sku.values';
import {
  CatalogAggregateVersionExhaustedError,
  InvalidCatalogAggregateVersionError,
  InvalidCatalogInstantError,
  InvalidCatalogLifecycleReasonCodeError,
  MAX_CATALOG_AGGREGATE_VERSION,
} from '../src/domain/catalog-values';

const SKU_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const PRODUCT_ID = '01890f3a-8bcd-7def-9abc-0123456789ac';
const SKU_CODE = 'MILK-1L';
const SKU_NAME = 'Whole milk 1L';
const RENAMED_SKU = 'Whole milk 1 litre';
const T0 = '2026-08-22T10:00:00.000001Z';
const T1 = '2026-08-22T10:01:00.000002Z';
const T2 = '2026-08-22T10:02:00.000003Z';
const T3 = '2026-08-22T10:03:00.000004Z';
const T4 = '2026-08-22T10:04:00.000005Z';
const BEFORE_T0 = '2026-08-22T09:59:59.999999Z';
const REASON_CODE = 'SAFETY_RECALL';

type RawSkuSnapshot = Readonly<{
  id: unknown;
  productId: unknown;
  code: unknown;
  name: unknown;
  status: unknown;
  version: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  statusChangedAt: unknown;
  activatedAt: unknown;
  retiredAt: unknown;
}>;

type LifecycleAction = 'activate' | 'suspend' | 'resume' | 'retire';

function draftSnapshot(overrides: Partial<RawSkuSnapshot> = {}): RawSkuSnapshot {
  return {
    id: SKU_ID,
    productId: PRODUCT_ID,
    code: SKU_CODE,
    name: SKU_NAME,
    status: 'DRAFT',
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    statusChangedAt: T0,
    activatedAt: null,
    retiredAt: null,
    ...overrides,
  };
}

function activeSnapshot(overrides: Partial<RawSkuSnapshot> = {}): RawSkuSnapshot {
  return draftSnapshot({
    status: 'ACTIVE',
    version: 2,
    updatedAt: T1,
    statusChangedAt: T1,
    activatedAt: T1,
    ...overrides,
  });
}

function suspendedSnapshot(overrides: Partial<RawSkuSnapshot> = {}): RawSkuSnapshot {
  return activeSnapshot({
    status: 'SUSPENDED',
    version: 3,
    updatedAt: T2,
    statusChangedAt: T2,
    ...overrides,
  });
}

function retiredSnapshot(overrides: Partial<RawSkuSnapshot> = {}): RawSkuSnapshot {
  return activeSnapshot({
    status: 'RETIRED',
    version: 3,
    updatedAt: T2,
    statusChangedAt: T2,
    retiredAt: T2,
    ...overrides,
  });
}

function createSku(): CatalogSku {
  return CatalogSku.create({
    id: SKU_ID,
    productId: PRODUCT_ID,
    code: SKU_CODE,
    name: SKU_NAME,
    occurredAt: T0,
  }).sku;
}

function skuInStatus(status: CatalogSkuStatus): CatalogSku {
  const draft = createSku();

  switch (status) {
    case 'DRAFT':
      return draft;
    case 'ACTIVE':
      return draft.activate({ expectedVersion: 1, occurredAt: T1 }).sku;
    case 'SUSPENDED': {
      const active = draft.activate({ expectedVersion: 1, occurredAt: T1 }).sku;
      return active.suspend({
        expectedVersion: 2,
        occurredAt: T2,
        reasonCode: REASON_CODE,
      }).sku;
    }
    case 'RETIRED':
      return draft.retire({
        expectedVersion: 1,
        occurredAt: T1,
        reasonCode: REASON_CODE,
      }).sku;
  }
}

function performLifecycle(
  sku: CatalogSku,
  action: LifecycleAction,
  occurredAt: unknown = T4,
  expectedVersion: unknown = sku.toSnapshot().version,
): CatalogSkuChangedResult<CatalogSkuMutationEvent> {
  switch (action) {
    case 'activate':
      return sku.activate({ expectedVersion, occurredAt });
    case 'suspend':
      return sku.suspend({ expectedVersion, occurredAt, reasonCode: REASON_CODE });
    case 'resume':
      return sku.resume({ expectedVersion, occurredAt });
    case 'retire':
      return sku.retire({ expectedVersion, occurredAt, reasonCode: REASON_CODE });
  }
}

function expectedLifecycleEvent(
  action: LifecycleAction,
  before: CatalogSkuSnapshot,
  after: CatalogSkuSnapshot,
): CatalogSkuDomainEvent {
  const common = {
    skuId: after.id,
    productId: after.productId,
    code: after.code,
    name: after.name,
    version: after.version,
    occurredAt: after.updatedAt,
  };

  switch (action) {
    case 'activate':
      return {
        ...common,
        type: 'SKU_ACTIVATED',
        previousStatus: 'DRAFT',
        status: 'ACTIVE',
      };
    case 'suspend':
      return {
        ...common,
        type: 'SKU_SUSPENDED',
        previousStatus: 'ACTIVE',
        status: 'SUSPENDED',
        reasonCode: REASON_CODE,
      };
    case 'resume':
      return {
        ...common,
        type: 'SKU_RESUMED',
        previousStatus: 'SUSPENDED',
        status: 'ACTIVE',
      };
    case 'retire':
      return {
        ...common,
        type: 'SKU_RETIRED',
        previousStatus: before.status as Exclude<CatalogSkuStatus, 'RETIRED'>,
        status: 'RETIRED',
        reasonCode: REASON_CODE,
      };
  }
}

describe('CatalogSku creation and rehydration', (): void => {
  it('creates the exact initial Draft state and one internal event', (): void => {
    const result = CatalogSku.create({
      id: SKU_ID,
      productId: PRODUCT_ID,
      code: SKU_CODE,
      name: SKU_NAME,
      occurredAt: T0,
    });

    expect(result).toEqual({
      kind: 'changed',
      sku: result.sku,
      event: {
        type: 'SKU_CREATED',
        skuId: SKU_ID,
        productId: PRODUCT_ID,
        code: SKU_CODE,
        name: SKU_NAME,
        status: 'DRAFT',
        version: 1,
        occurredAt: T0,
      },
    });
    expect(result.sku.toSnapshot()).toEqual(draftSnapshot());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sku)).toBe(true);
    expect(Object.isFrozen(result.event)).toBe(true);
    expect(Object.isFrozen(result.sku.toSnapshot())).toBe(true);
  });

  it('copies caller values into immutable state without retaining its object', (): void => {
    const input = {
      id: SKU_ID,
      productId: PRODUCT_ID,
      code: SKU_CODE,
      name: SKU_NAME,
      occurredAt: T0,
    };
    const sku = CatalogSku.create(input).sku;
    input.name = 'Changed outside the aggregate';
    input.code = 'OTHER-CODE';

    expect(sku.toSnapshot()).toMatchObject({ name: SKU_NAME, code: SKU_CODE });
    expect(() => {
      (sku.toSnapshot() as { productId: string }).productId = SKU_ID;
    }).toThrow(TypeError);
    expect(sku.toSnapshot().productId).toBe(PRODUCT_ID);
  });

  it.each([
    [
      'missing SKU identifier',
      { id: undefined, productId: PRODUCT_ID, code: SKU_CODE, name: SKU_NAME, occurredAt: T0 },
      InvalidCatalogSkuIdError,
    ],
    [
      'malformed SKU identifier',
      { id: 'not-a-sku-id', productId: PRODUCT_ID, code: SKU_CODE, name: SKU_NAME, occurredAt: T0 },
      InvalidCatalogSkuIdError,
    ],
    [
      'missing Product identifier',
      { id: SKU_ID, productId: undefined, code: SKU_CODE, name: SKU_NAME, occurredAt: T0 },
      InvalidCatalogProductIdError,
    ],
    [
      'malformed Product identifier',
      { id: SKU_ID, productId: 'not-a-product-id', code: SKU_CODE, name: SKU_NAME, occurredAt: T0 },
      InvalidCatalogProductIdError,
    ],
    [
      'missing code',
      { id: SKU_ID, productId: PRODUCT_ID, code: undefined, name: SKU_NAME, occurredAt: T0 },
      InvalidCatalogSkuCodeError,
    ],
    [
      'malformed code',
      { id: SKU_ID, productId: PRODUCT_ID, code: 'invalid', name: SKU_NAME, occurredAt: T0 },
      InvalidCatalogSkuCodeError,
    ],
    [
      'missing name',
      { id: SKU_ID, productId: PRODUCT_ID, code: SKU_CODE, name: undefined, occurredAt: T0 },
      InvalidCatalogNameError,
    ],
    [
      'malformed name',
      { id: SKU_ID, productId: PRODUCT_ID, code: SKU_CODE, name: ' invalid', occurredAt: T0 },
      InvalidCatalogNameError,
    ],
    [
      'missing occurrence time',
      { id: SKU_ID, productId: PRODUCT_ID, code: SKU_CODE, name: SKU_NAME, occurredAt: undefined },
      InvalidCatalogInstantError,
    ],
    [
      'malformed occurrence time',
      { id: SKU_ID, productId: PRODUCT_ID, code: SKU_CODE, name: SKU_NAME, occurredAt: 'invalid' },
      InvalidCatalogInstantError,
    ],
  ] as const)(
    'rejects factory input with a %s before returning state or an event',
    (_scenario, input, expectedError): void => {
      let result: ReturnType<typeof CatalogSku.create> | null = null;

      expect(() => {
        result = CatalogSku.create(input satisfies CreateCatalogSkuInput);
      }).toThrow(expectedError);
      expect(result).toBeNull();
    },
  );

  it.each([
    ['Draft after a rename', draftSnapshot({ version: 2, updatedAt: T1 })],
    ['first-active SKU', activeSnapshot()],
    ['resumed Active SKU', activeSnapshot({ version: 4, updatedAt: T3, statusChangedAt: T3 })],
    ['Suspended SKU', suspendedSnapshot()],
    [
      'SKU retired directly from Draft',
      draftSnapshot({
        status: 'RETIRED',
        version: 2,
        updatedAt: T1,
        statusChangedAt: T1,
        retiredAt: T1,
      }),
    ],
    ['previously activated Retired SKU', retiredSnapshot()],
  ])('rehydrates a valid %s without creating an event', (_scenario, snapshot): void => {
    const sku = CatalogSku.rehydrate(snapshot);

    expect(sku.toSnapshot()).toEqual(snapshot);
    expect(Object.isFrozen(sku)).toBe(true);
    expect(Object.isFrozen(sku.toSnapshot())).toBe(true);
    expect(Object.keys(sku)).toEqual([]);
  });

  it('does not retain a mutable rehydration object', (): void => {
    const snapshot = { ...activeSnapshot() };
    const sku = CatalogSku.rehydrate(snapshot);
    snapshot.name = 'Changed persistence record';
    snapshot.code = 'OTHER-CODE';

    expect(sku.toSnapshot()).toMatchObject({ name: SKU_NAME, code: SKU_CODE });
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing required member', { id: SKU_ID }],
    ['additional member', { ...draftSnapshot(), internal: 'value' }],
    ['invalid SKU id', draftSnapshot({ id: 'persistence-sku-id' })],
    ['invalid Product id', draftSnapshot({ productId: 'persistence-product-id' })],
    ['invalid code', draftSnapshot({ code: 'invalid-code' })],
    ['invalid name', draftSnapshot({ name: ' invalid' })],
    ['invalid status', draftSnapshot({ status: 'ARCHIVED' })],
    ['invalid version', draftSnapshot({ version: 0 })],
    ['invalid creation instant', draftSnapshot({ createdAt: 'not-an-instant' })],
    ['undefined nullable activation', draftSnapshot({ activatedAt: undefined })],
    ['updated before creation', draftSnapshot({ updatedAt: BEFORE_T0 })],
    ['status changed before creation', draftSnapshot({ statusChangedAt: BEFORE_T0 })],
    ['status changed after update', activeSnapshot({ statusChangedAt: T2 })],
    ['activation before creation', activeSnapshot({ activatedAt: BEFORE_T0 })],
    ['activation after update', activeSnapshot({ activatedAt: T2 })],
    ['retirement before creation', retiredSnapshot({ retiredAt: BEFORE_T0 })],
    ['retirement after update', retiredSnapshot({ retiredAt: T3 })],
    ['Draft with activation', draftSnapshot({ activatedAt: T0 })],
    ['Draft with retirement', draftSnapshot({ retiredAt: T0 })],
    ['Draft with changed lifecycle time', draftSnapshot({ statusChangedAt: T1, updatedAt: T1 })],
    ['initial Draft with a later update', draftSnapshot({ updatedAt: T1 })],
    ['Active without activation', activeSnapshot({ activatedAt: null })],
    ['Active at unreachable version 1', activeSnapshot({ version: 1 })],
    ['first Active with a later update', activeSnapshot({ updatedAt: T2 })],
    [
      'resumed Active lifecycle time at unreachable version 3',
      activeSnapshot({ version: 3, updatedAt: T2, statusChangedAt: T2 }),
    ],
    ['Active with retirement', activeSnapshot({ retiredAt: T1 })],
    [
      'Active status change before activation',
      activeSnapshot({ activatedAt: T2, updatedAt: T2, statusChangedAt: T1 }),
    ],
    ['Suspended without activation', suspendedSnapshot({ activatedAt: null })],
    ['Suspended at unreachable version 2', suspendedSnapshot({ version: 2 })],
    ['first Suspended with a later update', suspendedSnapshot({ updatedAt: T3 })],
    ['Suspended with retirement', suspendedSnapshot({ retiredAt: T2 })],
    ['Retired without retirement time', retiredSnapshot({ retiredAt: null })],
    ['Retired with mismatched status time', retiredSnapshot({ statusChangedAt: T1 })],
    ['Retired with later update', retiredSnapshot({ updatedAt: T3 })],
    [
      'directly Retired SKU at unreachable version 1',
      draftSnapshot({
        status: 'RETIRED',
        version: 1,
        updatedAt: T1,
        statusChangedAt: T1,
        retiredAt: T1,
      }),
    ],
    ['activated Retired SKU at unreachable version 2', retiredSnapshot({ version: 2 })],
    [
      'retirement before first activation',
      retiredSnapshot({ activatedAt: T3, retiredAt: T2, statusChangedAt: T2, updatedAt: T3 }),
    ],
  ])('rejects a corrupt %s with one fixed cause-free error', (_scenario, snapshot): void => {
    let error: unknown;

    try {
      CatalogSku.rehydrate(snapshot);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidCatalogSkuStateError);
    expect(String(error)).toBe(
      'InvalidCatalogSkuStateError: Expected a valid Catalog SKU snapshot',
    );
    expect(JSON.stringify(error)).not.toContain('persistence-sku-id');
    expect(JSON.stringify(error)).not.toContain('persistence-product-id');
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe('CatalogSku rename', (): void => {
  it.each(['DRAFT', 'ACTIVE', 'SUSPENDED'] as const)(
    'renames a %s SKU while preserving ownership and lifecycle metadata',
    (status): void => {
      const sku = skuInStatus(status);
      const before = sku.toSnapshot();
      const result = sku.rename({
        name: RENAMED_SKU,
        expectedVersion: before.version,
        occurredAt: T4,
      });

      expect(result.kind).toBe('changed');
      if (result.kind !== 'changed') {
        throw new Error('Expected a changed rename result');
      }

      expect(result.sku.toSnapshot()).toEqual({
        ...before,
        name: RENAMED_SKU,
        version: before.version + 1,
        updatedAt: T4,
      });
      expect(result.event).toEqual({
        type: 'SKU_RENAMED',
        skuId: SKU_ID,
        productId: PRODUCT_ID,
        code: SKU_CODE,
        previousName: SKU_NAME,
        name: RENAMED_SKU,
        status,
        version: before.version + 1,
        occurredAt: T4,
      });
      expect(CatalogSku.rehydrate(result.sku.toSnapshot()).toSnapshot()).toEqual(
        result.sku.toSnapshot(),
      );
      expect(sku.toSnapshot()).toBe(before);
      expect(Object.isFrozen(result.event)).toBe(true);
    },
  );

  it.each(['DRAFT', 'ACTIVE', 'SUSPENDED'] as const)(
    'returns an event-free, clock-free no-op for a same-name %s SKU',
    (status): void => {
      const sku = skuInStatus(status);
      const before = sku.toSnapshot();
      const result = sku.rename({
        name: SKU_NAME,
        expectedVersion: before.version,
        occurredAt: 'not-inspected-for-a-no-op',
      });

      expect(result).toEqual({ kind: 'unchanged', sku });
      expect(result.sku).toBe(sku);
      expect(result.sku.toSnapshot()).toBe(before);
      expect('event' in result).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it('checks the expected version before accepting a same-name no-op', (): void => {
    const sku = createSku();

    expect(() => sku.rename({ name: SKU_NAME, expectedVersion: 2, occurredAt: T1 })).toThrow(
      CatalogSkuVersionMismatchError,
    );
  });

  it('rejects a same-name Retired SKU as a lifecycle conflict', (): void => {
    const sku = skuInStatus('RETIRED');
    const before = sku.toSnapshot();

    expect(() =>
      sku.rename({ name: SKU_NAME, expectedVersion: before.version, occurredAt: T4 }),
    ).toThrow(CatalogSkuLifecycleConflictError);
    expect(sku.toSnapshot()).toBe(before);
  });

  it('rejects an invalid name without mutating the SKU', (): void => {
    const sku = createSku();
    const before = sku.toSnapshot();

    expect(() => sku.rename({ name: ' invalid', expectedVersion: 1, occurredAt: T1 })).toThrow(
      InvalidCatalogNameError,
    );
    expect(sku.toSnapshot()).toBe(before);
  });
});

describe('CatalogSku lifecycle', (): void => {
  it.each([
    ['DRAFT', 'activate', 'ACTIVE'],
    ['DRAFT', 'retire', 'RETIRED'],
    ['ACTIVE', 'suspend', 'SUSPENDED'],
    ['ACTIVE', 'retire', 'RETIRED'],
    ['SUSPENDED', 'resume', 'ACTIVE'],
    ['SUSPENDED', 'retire', 'RETIRED'],
  ] as const)(
    'applies the allowed %s -> %s transition',
    (sourceStatus, action, resultingStatus): void => {
      const sku = skuInStatus(sourceStatus);
      const before = sku.toSnapshot();
      const result = performLifecycle(sku, action);
      const after = result.sku.toSnapshot();

      expect(after).toEqual({
        ...before,
        status: resultingStatus,
        version: before.version + 1,
        updatedAt: T4,
        statusChangedAt: T4,
        activatedAt: action === 'activate' ? T4 : before.activatedAt,
        retiredAt: action === 'retire' ? T4 : before.retiredAt,
      });
      expect(result.event).toEqual(expectedLifecycleEvent(action, before, after));
      expect(CatalogSku.rehydrate(after).toSnapshot()).toEqual(after);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.event)).toBe(true);
      expect(sku.toSnapshot()).toBe(before);
    },
  );

  it.each([
    ['DRAFT', 'suspend'],
    ['DRAFT', 'resume'],
    ['ACTIVE', 'activate'],
    ['ACTIVE', 'resume'],
    ['SUSPENDED', 'activate'],
    ['SUSPENDED', 'suspend'],
    ['RETIRED', 'activate'],
    ['RETIRED', 'suspend'],
    ['RETIRED', 'resume'],
    ['RETIRED', 'retire'],
  ] as const)('rejects the forbidden %s -> %s operation atomically', (status, action): void => {
    const sku = skuInStatus(status);
    const before = sku.toSnapshot();

    expect(() => performLifecycle(sku, action)).toThrow(CatalogSkuLifecycleConflictError);
    expect(sku.toSnapshot()).toBe(before);
  });

  it('preserves first activation across suspend, resume, and retirement', (): void => {
    const active = skuInStatus('ACTIVE');
    const activatedAt = active.toSnapshot().activatedAt;
    const suspended = active.suspend({
      expectedVersion: 2,
      occurredAt: T2,
      reasonCode: REASON_CODE,
    }).sku;
    const resumed = suspended.resume({ expectedVersion: 3, occurredAt: T3 }).sku;
    const retired = resumed.retire({
      expectedVersion: 4,
      occurredAt: T4,
      reasonCode: REASON_CODE,
    }).sku;

    expect(suspended.toSnapshot().activatedAt).toBe(activatedAt);
    expect(resumed.toSnapshot().activatedAt).toBe(activatedAt);
    expect(retired.toSnapshot()).toMatchObject({ activatedAt, retiredAt: T4 });
  });

  it('accepts an equal microsecond mutation time because version orders changes', (): void => {
    const active = skuInStatus('ACTIVE');
    const result = active.suspend({
      expectedVersion: 2,
      occurredAt: T1,
      reasonCode: REASON_CODE,
    });

    expect(result.sku.toSnapshot()).toMatchObject({
      status: 'SUSPENDED',
      version: 3,
      updatedAt: T1,
      statusChangedAt: T1,
    });
  });

  it.each([
    [
      'rename',
      createSku(),
      (sku: CatalogSku): unknown =>
        sku.rename({ name: RENAMED_SKU, expectedVersion: 2, occurredAt: T1 }),
    ],
    [
      'activate',
      createSku(),
      (sku: CatalogSku): unknown => sku.activate({ expectedVersion: 2, occurredAt: T1 }),
    ],
    [
      'suspend',
      skuInStatus('ACTIVE'),
      (sku: CatalogSku): unknown =>
        sku.suspend({ expectedVersion: 3, occurredAt: T2, reasonCode: REASON_CODE }),
    ],
    [
      'resume',
      skuInStatus('SUSPENDED'),
      (sku: CatalogSku): unknown => sku.resume({ expectedVersion: 4, occurredAt: T3 }),
    ],
    [
      'retire',
      createSku(),
      (sku: CatalogSku): unknown =>
        sku.retire({ expectedVersion: 2, occurredAt: T1, reasonCode: REASON_CODE }),
    ],
  ] as const)('rejects a stale expected version before %s', (_action, sku, invoke): void => {
    const before = sku.toSnapshot();

    expect(() => invoke(sku)).toThrow(CatalogSkuVersionMismatchError);
    expect(sku.toSnapshot()).toBe(before);
  });

  it('rejects an invalid expected version category without exposing state', (): void => {
    const sku = createSku();

    expect(() => sku.activate({ expectedVersion: 0, occurredAt: T1 })).toThrow(
      InvalidCatalogAggregateVersionError,
    );
  });

  it.each([
    [
      'rename',
      skuInStatus('DRAFT'),
      (sku: CatalogSku): unknown =>
        sku.rename({ name: RENAMED_SKU, expectedVersion: 1, occurredAt: BEFORE_T0 }),
    ],
    [
      'activate',
      skuInStatus('DRAFT'),
      (sku: CatalogSku): unknown => sku.activate({ expectedVersion: 1, occurredAt: BEFORE_T0 }),
    ],
    [
      'suspend',
      skuInStatus('ACTIVE'),
      (sku: CatalogSku): unknown =>
        sku.suspend({ expectedVersion: 2, occurredAt: BEFORE_T0, reasonCode: REASON_CODE }),
    ],
    [
      'resume',
      skuInStatus('SUSPENDED'),
      (sku: CatalogSku): unknown => sku.resume({ expectedVersion: 3, occurredAt: BEFORE_T0 }),
    ],
    [
      'retire',
      skuInStatus('DRAFT'),
      (sku: CatalogSku): unknown =>
        sku.retire({ expectedVersion: 1, occurredAt: BEFORE_T0, reasonCode: REASON_CODE }),
    ],
  ] as const)(
    'rejects timestamp regression for %s without mutation',
    (_action, sku, invoke): void => {
      const before = sku.toSnapshot();

      expect(() => invoke(sku)).toThrow(CatalogSkuTimestampRegressionError);
      expect(sku.toSnapshot()).toBe(before);
    },
  );

  it('rejects malformed mutation time and lifecycle reason without mutation', (): void => {
    const active = skuInStatus('ACTIVE');
    const before = active.toSnapshot();

    expect(() =>
      active.suspend({ expectedVersion: 2, occurredAt: 'invalid-time', reasonCode: REASON_CODE }),
    ).toThrow(InvalidCatalogInstantError);
    expect(() =>
      active.suspend({ expectedVersion: 2, occurredAt: T2, reasonCode: 'CUSTOM_REASON' }),
    ).toThrow(InvalidCatalogLifecycleReasonCodeError);
    expect(() =>
      active.retire({ expectedVersion: 2, occurredAt: T2, reasonCode: 'CUSTOM_REASON' }),
    ).toThrow(InvalidCatalogLifecycleReasonCodeError);
    expect(() =>
      active.retire({ expectedVersion: 2, occurredAt: T2, reasonCode: undefined }),
    ).toThrow(InvalidCatalogLifecycleReasonCodeError);
    expect(active.toSnapshot()).toBe(before);
  });
});

describe('CatalogSku version exhaustion and safe errors', (): void => {
  it('allows a same-value no-op at maximum version without inspecting the clock', (): void => {
    const sku = CatalogSku.rehydrate(draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }));
    const result = sku.rename({
      name: SKU_NAME,
      expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
      occurredAt: 'not-a-clock-value',
    });

    expect(result).toEqual({ kind: 'unchanged', sku });
  });

  it.each([
    [
      'rename',
      draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (sku: CatalogSku): unknown =>
        sku.rename({
          name: RENAMED_SKU,
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
        }),
    ],
    [
      'activate',
      draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (sku: CatalogSku): unknown =>
        sku.activate({ expectedVersion: MAX_CATALOG_AGGREGATE_VERSION, occurredAt: T4 }),
    ],
    [
      'suspend',
      activeSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (sku: CatalogSku): unknown =>
        sku.suspend({
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
          reasonCode: REASON_CODE,
        }),
    ],
    [
      'resume',
      suspendedSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (sku: CatalogSku): unknown =>
        sku.resume({ expectedVersion: MAX_CATALOG_AGGREGATE_VERSION, occurredAt: T4 }),
    ],
    [
      'retire',
      draftSnapshot({ version: MAX_CATALOG_AGGREGATE_VERSION }),
      (sku: CatalogSku): unknown =>
        sku.retire({
          expectedVersion: MAX_CATALOG_AGGREGATE_VERSION,
          occurredAt: T4,
          reasonCode: REASON_CODE,
        }),
    ],
  ] as const)('rejects version exhaustion for an actual %s', (_action, snapshot, invoke): void => {
    const sku = CatalogSku.rehydrate(snapshot);
    const before = sku.toSnapshot();

    expect(() => invoke(sku)).toThrow(CatalogAggregateVersionExhaustedError);
    expect(sku.toSnapshot()).toBe(before);
  });

  it('keeps lifecycle conflicts free of state, identifiers, code, and reason', (): void => {
    const sku = skuInStatus('RETIRED');
    let error: unknown;

    try {
      sku.retire({
        expectedVersion: sku.toSnapshot().version,
        occurredAt: T4,
        reasonCode: REASON_CODE,
      });
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CatalogSkuLifecycleConflictError);
    expect(String(error)).not.toContain('RETIRED');
    expect(String(error)).not.toContain(REASON_CODE);
    expect(JSON.stringify(error)).not.toContain(SKU_ID);
    expect(JSON.stringify(error)).not.toContain(PRODUCT_ID);
    expect(JSON.stringify(error)).not.toContain(SKU_CODE);
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });

  it.each([
    [
      'version mismatch',
      (): unknown => createSku().activate({ expectedVersion: 2, occurredAt: T1 }),
      'CatalogSkuVersionMismatchError: The Catalog SKU version does not match the expected version',
    ],
    [
      'timestamp regression',
      (): unknown => createSku().activate({ expectedVersion: 1, occurredAt: BEFORE_T0 }),
      'CatalogSkuTimestampRegressionError: The Catalog SKU mutation time precedes its current update time',
    ],
  ] as const)('publishes a fixed cause-free %s error', (_scenario, invoke, message): void => {
    let error: unknown;

    try {
      invoke();
    } catch (caught: unknown) {
      error = caught;
    }

    expect(String(error)).toBe(message);
    expect(JSON.stringify(error)).not.toContain(SKU_ID);
    expect(JSON.stringify(error)).not.toContain(PRODUCT_ID);
    expect(JSON.stringify(error)).not.toContain(SKU_CODE);
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });
});
