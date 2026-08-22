import { InvalidCatalogSkuIdError, parseCatalogSkuId } from '../src';

describe('parseCatalogSkuId', (): void => {
  it.each([
    '00000000-0000-7000-8000-000000000000',
    '01890f3a-8bcd-7def-8abc-0123456789ab',
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ])('retains a canonical lowercase UUIDv7: %s', (skuId): void => {
    expect(parseCatalogSkuId(skuId)).toBe(skuId);
  });

  it.each([
    ['uppercase hexadecimal', '01890F3A-8BCD-7DEF-8ABC-0123456789AB'],
    ['UUIDv4', '01890f3a-8bcd-4def-8abc-0123456789ab'],
    ['UUIDv6', '01890f3a-8bcd-6def-8abc-0123456789ab'],
    ['UUIDv8', '01890f3a-8bcd-8def-8abc-0123456789ab'],
    ['non-RFC variant', '01890f3a-8bcd-7def-7abc-0123456789ab'],
    ['missing separators', '01890f3a8bcd7def8abc0123456789ab'],
    ['invalid hexadecimal', '01890f3a-8bcd-7def-8abc-0123456789az'],
    ['leading whitespace', ' 01890f3a-8bcd-7def-8abc-0123456789ab'],
    ['trailing whitespace', '01890f3a-8bcd-7def-8abc-0123456789ab '],
    ['empty input', ''],
  ])('rejects %s', (_scenario, skuId): void => {
    expect(() => parseCatalogSkuId(skuId)).toThrow(InvalidCatalogSkuIdError);
  });

  it.each([undefined, null, 7, {}, []])('rejects a non-string runtime value: %p', (skuId): void => {
    expect(() => parseCatalogSkuId(skuId)).toThrow(InvalidCatalogSkuIdError);
  });

  it('does not expose the rejected identifier in the error', (): void => {
    const rejectedValue = 'customer-controlled-value';

    expect(() => parseCatalogSkuId(rejectedValue)).toThrow(
      'Expected a canonical lowercase UUIDv7 Catalog SKU identifier',
    );

    try {
      parseCatalogSkuId(rejectedValue);
    } catch (error: unknown) {
      expect(String(error)).not.toContain(rejectedValue);
    }
  });
});
