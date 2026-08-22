import {
  CATALOG_SKU_STATUSES,
  InvalidCatalogSkuCodeError,
  InvalidCatalogSkuStatusError,
  parseCatalogSkuCode,
  parseCatalogSkuStatus,
} from '../src/domain/catalog-sku.values';

describe('Catalog SKU values', (): void => {
  describe('parseCatalogSkuCode', (): void => {
    it.each(['ABC', '123', 'MILK-1L', 'SKU.V2_BLUE', `A${'Z'.repeat(63)}`])(
      'retains a valid immutable code: %s',
      (code): void => {
        expect(parseCatalogSkuCode(code)).toBe(code);
      },
    );

    it.each([
      ['empty', ''],
      ['one character', 'A'],
      ['two characters', 'AB'],
      ['more than 64 characters', `A${'Z'.repeat(64)}`],
      ['lowercase ASCII', 'Milk-1L'],
      ['leading period', '.ABC'],
      ['leading underscore', '_ABC'],
      ['leading hyphen', '-ABC'],
      ['whitespace', 'MILK 1L'],
      ['slash', 'MILK/1L'],
      ['plus sign', 'MILK+1L'],
      ['colon', 'MILK:1L'],
      ['non-ASCII', 'CAFÉ'],
      ['full-width confusable', 'ＭILK'],
      ['control character', 'MILK\n1L'],
      ['Unicode line separator', 'MILK\u20281L'],
      ['zero-width character', 'MILK\u200b1L'],
      ['leading whitespace', ' MILK-1L'],
      ['trailing whitespace', 'MILK-1L '],
    ])('rejects a code with %s', (_scenario, code): void => {
      expect(() => parseCatalogSkuCode(code)).toThrow(InvalidCatalogSkuCodeError);
    });

    it.each([undefined, null, 7, {}, []])('rejects a non-string runtime code: %p', (code): void => {
      expect(() => parseCatalogSkuCode(code)).toThrow(InvalidCatalogSkuCodeError);
    });

    it('does not normalize or disclose a rejected code', (): void => {
      const rejectedCode = 'customer-controlled-secret-code';
      let error: unknown;

      try {
        parseCatalogSkuCode(rejectedCode);
      } catch (caught: unknown) {
        error = caught;
      }

      expect(String(error)).toBe('InvalidCatalogSkuCodeError: Expected a valid Catalog SKU code');
      expect(String(error)).not.toContain(rejectedCode);
      expect((error as { cause?: unknown }).cause).toBeUndefined();
    });
  });

  describe('parseCatalogSkuStatus', (): void => {
    it.each(CATALOG_SKU_STATUSES)('retains the supported %s status', (status): void => {
      expect(parseCatalogSkuStatus(status)).toBe(status);
    });

    it.each(['ARCHIVED', 'active', ' DRAFT', 'DRAFT ', '', undefined, null, 7, {}, []])(
      'rejects an unsupported runtime status: %p',
      (status): void => {
        expect(() => parseCatalogSkuStatus(status)).toThrow(InvalidCatalogSkuStatusError);
      },
    );

    it('publishes a frozen status registry and a fixed safe error', (): void => {
      expect(Object.isFrozen(CATALOG_SKU_STATUSES)).toBe(true);

      let error: unknown;
      try {
        parseCatalogSkuStatus('persistence-status');
      } catch (caught: unknown) {
        error = caught;
      }

      expect(String(error)).toBe(
        'InvalidCatalogSkuStatusError: Expected a supported Catalog SKU status',
      );
      expect(String(error)).not.toContain('persistence-status');
      expect((error as { cause?: unknown }).cause).toBeUndefined();
    });
  });
});
