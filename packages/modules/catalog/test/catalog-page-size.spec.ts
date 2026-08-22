import {
  DEFAULT_CATALOG_PAGE_SIZE,
  InvalidCatalogPageSizeError,
  MAX_CATALOG_PAGE_SIZE,
  parseCatalogPageSize,
} from '../src';

describe('parseCatalogPageSize', (): void => {
  it('uses the bounded default when the caller omits a page size', (): void => {
    expect(parseCatalogPageSize(undefined)).toBe(DEFAULT_CATALOG_PAGE_SIZE);
    expect(DEFAULT_CATALOG_PAGE_SIZE).toBe(20);
    expect(MAX_CATALOG_PAGE_SIZE).toBe(100);
  });

  it.each([1, 20, 99, 100])('retains an allowed integer page size: %d', (limit): void => {
    expect(parseCatalogPageSize(limit)).toBe(limit);
  });

  it.each([0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an out-of-policy numeric value: %p',
    (limit): void => {
      expect(() => parseCatalogPageSize(limit)).toThrow(InvalidCatalogPageSizeError);
    },
  );

  it.each([null, '20', true, {}, []])('rejects a non-number runtime value: %p', (limit): void => {
    expect(() => parseCatalogPageSize(limit)).toThrow(InvalidCatalogPageSizeError);
  });

  it('reports the stable public policy without reflecting the rejected value', (): void => {
    expect(() => parseCatalogPageSize(101)).toThrow(
      'Catalog page size must be an integer between 1 and 100',
    );
  });
});
