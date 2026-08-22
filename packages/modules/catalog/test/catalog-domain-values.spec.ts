import {
  InvalidCatalogNameError,
  MAX_CATALOG_NAME_CODE_POINTS,
  parseCatalogName,
} from '../src/domain/catalog-name';
import {
  CATALOG_PRODUCT_STATUSES,
  InvalidCatalogProductIdError,
  InvalidCatalogProductStatusError,
  parseCatalogProductId,
  parseCatalogProductStatus,
} from '../src/domain/catalog-product.values';
import {
  CATALOG_LIFECYCLE_REASON_CODES,
  CatalogAggregateVersionExhaustedError,
  InvalidCatalogAggregateVersionError,
  InvalidCatalogInstantError,
  InvalidCatalogLifecycleReasonCodeError,
  MAX_CATALOG_AGGREGATE_VERSION,
  compareCatalogInstants,
  nextCatalogAggregateVersion,
  parseCatalogAggregateVersion,
  parseCatalogInstant,
  parseCatalogLifecycleReasonCode,
} from '../src/domain/catalog-values';

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

function expectFixedSafeError(
  operation: () => unknown,
  expectedClass: ErrorClass,
  rejectedValue: string,
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect(String(error)).not.toContain(rejectedValue);
  expect(JSON.stringify(error)).not.toContain(rejectedValue);
}

describe('Catalog Product identifiers and statuses', (): void => {
  it.each([
    '00000000-0000-7000-8000-000000000000',
    '01890f3a-8bcd-7def-8abc-0123456789ab',
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ])('retains a canonical lowercase UUIDv7 Product id: %s', (productId): void => {
    expect(parseCatalogProductId(productId)).toBe(productId);
  });

  it.each([
    '01890F3A-8BCD-7DEF-8ABC-0123456789AB',
    '01890f3a-8bcd-4def-8abc-0123456789ab',
    '01890f3a-8bcd-7def-7abc-0123456789ab',
    ' 01890f3a-8bcd-7def-8abc-0123456789ab',
    '01890f3a-8bcd-7def-8abc-0123456789ab ',
    'not-a-product-id',
  ])('rejects a noncanonical Product id: %s', (productId): void => {
    expect(() => parseCatalogProductId(productId)).toThrow(InvalidCatalogProductIdError);
  });

  it.each([undefined, null, 7, {}, []])(
    'rejects a non-string Product id: %p',
    (productId): void => {
      expect(() => parseCatalogProductId(productId)).toThrow(InvalidCatalogProductIdError);
    },
  );

  it('does not expose a rejected Product id', (): void => {
    const rejected = 'customer-product-id';
    expectFixedSafeError(
      () => parseCatalogProductId(rejected),
      InvalidCatalogProductIdError,
      rejected,
    );
  });

  it.each(CATALOG_PRODUCT_STATUSES)('retains supported Product status %s', (status): void => {
    expect(parseCatalogProductStatus(status)).toBe(status);
  });

  it.each(['draft', 'RETIRED', ' ACTIVE ', '', null, 1])(
    'rejects unsupported Product status %p',
    (status): void => {
      expect(() => parseCatalogProductStatus(status)).toThrow(InvalidCatalogProductStatusError);
    },
  );
});

describe('Catalog names', (): void => {
  it.each([
    ['one code point', 'A'],
    ['composed NFC text', 'Café'],
    ['astral character', 'Milk 🥛'],
    ['interior Unicode whitespace', 'Whole\u2003milk'],
    ['maximum code-point length', '😀'.repeat(MAX_CATALOG_NAME_CODE_POINTS)],
  ])('retains valid %s without transformation', (_scenario, name): void => {
    expect(parseCatalogName(name)).toBe(name);
  });

  it.each([
    ['empty text', ''],
    ['too many code points', '😀'.repeat(MAX_CATALOG_NAME_CODE_POINTS + 1)],
    ['decomposed non-NFC text', 'Cafe\u0301'],
    ['leading ASCII whitespace', ' Whole milk'],
    ['trailing ASCII whitespace', 'Whole milk '],
    ['leading no-break space', '\u00a0Whole milk'],
    ['trailing ideographic space', 'Whole milk\u3000'],
    ['C0 control', 'Whole\u0007milk'],
    ['C1 control', 'Whole\u0085milk'],
    ['lone high surrogate', 'Whole\ud800milk'],
    ['lone low surrogate', 'Whole\udc00milk'],
  ])('rejects %s', (_scenario, name): void => {
    expect(() => parseCatalogName(name)).toThrow(InvalidCatalogNameError);
  });

  it.each([undefined, null, 7, {}, []])('rejects a non-string name: %p', (name): void => {
    expect(() => parseCatalogName(name)).toThrow(InvalidCatalogNameError);
  });

  it('does not expose or silently normalize a rejected name', (): void => {
    const rejected = 'Sensitive Cafe\u0301';
    expectFixedSafeError(() => parseCatalogName(rejected), InvalidCatalogNameError, rejected);
  });
});

describe('Catalog instants', (): void => {
  it.each([
    '1000-01-01T00:00:00.000000Z',
    '2000-02-29T23:59:59.000001Z',
    '2026-08-22T12:34:56.123456Z',
    '9999-12-31T23:59:59.999999Z',
  ])('retains a valid lossless instant: %s', (instant): void => {
    expect(parseCatalogInstant(instant)).toBe(instant);
  });

  it.each([
    '0999-12-31T23:59:59.999999Z',
    '2023-02-29T12:00:00.000000Z',
    '2026-04-31T12:00:00.000000Z',
    '2026-13-01T12:00:00.000000Z',
    '2026-08-22T24:00:00.000000Z',
    '2026-08-22T23:60:00.000000Z',
    '2026-08-22T23:59:60.000000Z',
    '2026-08-22T12:34:56.123Z',
    '2026-08-22T12:34:56.1234567Z',
    '2026-08-22T12:34:56.123456+00:00',
    '2026-08-22t12:34:56.123456Z',
    ' 2026-08-22T12:34:56.123456Z',
  ])('rejects an invalid or noncanonical instant: %s', (instant): void => {
    expect(() => parseCatalogInstant(instant)).toThrow(InvalidCatalogInstantError);
  });

  it.each([undefined, null, 7, {}, []])('rejects a non-string instant: %p', (instant): void => {
    expect(() => parseCatalogInstant(instant)).toThrow(InvalidCatalogInstantError);
  });

  it('compares all six fractional digits without Date conversion', (): void => {
    const earlier = parseCatalogInstant('2026-08-22T12:34:56.123456Z');
    const later = parseCatalogInstant('2026-08-22T12:34:56.123457Z');

    expect(compareCatalogInstants(earlier, later)).toBe(-1);
    expect(compareCatalogInstants(later, earlier)).toBe(1);
    expect(compareCatalogInstants(earlier, earlier)).toBe(0);
  });

  it('does not expose a rejected instant', (): void => {
    const rejected = 'customer-timestamp';
    expectFixedSafeError(() => parseCatalogInstant(rejected), InvalidCatalogInstantError, rejected);
  });
});

describe('Catalog aggregate versions', (): void => {
  it.each([1, 2, MAX_CATALOG_AGGREGATE_VERSION])(
    'retains supported version %d',
    (version): void => {
      expect(parseCatalogAggregateVersion(version)).toBe(version);
    },
  );

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_CATALOG_AGGREGATE_VERSION + 1,
    '1',
    null,
  ])('rejects unsupported version %p', (version): void => {
    expect(() => parseCatalogAggregateVersion(version)).toThrow(
      InvalidCatalogAggregateVersionError,
    );
  });

  it('increments a validated version exactly once', (): void => {
    expect(nextCatalogAggregateVersion(parseCatalogAggregateVersion(41))).toBe(42);
  });

  it('rejects unsigned-version exhaustion', (): void => {
    expect(() =>
      nextCatalogAggregateVersion(parseCatalogAggregateVersion(MAX_CATALOG_AGGREGATE_VERSION)),
    ).toThrow(CatalogAggregateVersionExhaustedError);
  });
});

describe('Catalog lifecycle reason codes', (): void => {
  it.each(CATALOG_LIFECYCLE_REASON_CODES)('retains supported reason %s', (reasonCode): void => {
    expect(parseCatalogLifecycleReasonCode(reasonCode)).toBe(reasonCode);
  });

  it.each(['safety_recall', 'SAFETY RECALL', ' SAFETY_RECALL', 'SAFETY_RECALL ', '', null, 1])(
    'rejects unsupported reason %p',
    (reasonCode): void => {
      expect(() => parseCatalogLifecycleReasonCode(reasonCode)).toThrow(
        InvalidCatalogLifecycleReasonCodeError,
      );
    },
  );

  it('does not expose a rejected reason', (): void => {
    const rejected = 'customer-reason';
    expectFixedSafeError(
      () => parseCatalogLifecycleReasonCode(rejected),
      InvalidCatalogLifecycleReasonCodeError,
      rejected,
    );
  });
});
