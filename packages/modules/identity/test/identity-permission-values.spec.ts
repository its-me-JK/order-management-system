import {
  InvalidIdentityPermissionCodeError,
  MAX_IDENTITY_PERMISSION_CODE_LENGTH,
  MAX_IDENTITY_ROLE_PERMISSIONS,
  parseIdentityPermissionCode,
} from '../src/domain/identity-permission.values';

const INITIAL_PERMISSION_CODES = Object.freeze([
  'catalog.products.read',
  'catalog.products.write',
  'catalog.products.publish',
  'catalog.skus.read',
  'catalog.skus.write',
  'catalog.skus.publish',
  'audit.records.read',
] as const);

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

describe('Identity permission codes', (): void => {
  it.each(INITIAL_PERMISSION_CODES)('retains initial permission %s exactly', (code): void => {
    expect(parseIdentityPermissionCode(code)).toBe(code);
  });

  it.each([
    ['minimum segment lengths', 'a.b.c'],
    ['digits after segment initials', 'orders.v2.read1'],
    ['single internal hyphens', 'catalog.product-variants.read-only'],
    ['maximum segment lengths', `${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`],
  ])('retains a canonical code with %s', (_scenario, code): void => {
    expect(parseIdentityPermissionCode(code)).toBe(code);
  });

  it.each([
    ['empty value', ''],
    ['one segment', 'catalog'],
    ['two segments', 'catalog.products'],
    ['four segments', 'catalog.products.prices.read'],
    ['leading dot', '.catalog.products.read'],
    ['trailing dot', 'catalog.products.read.'],
    ['empty middle segment', 'catalog..read'],
    ['uppercase ASCII', 'Catalog.products.read'],
    ['digit at segment start', 'catalog.2products.read'],
    ['underscore', 'catalog.product_variants.read'],
    ['wildcard', 'catalog.products.*'],
    ['colon', 'catalog.products:read'],
    ['slash', 'catalog/products/read'],
    ['leading hyphen', 'catalog.-products.read'],
    ['trailing hyphen', 'catalog.products-.read'],
    ['consecutive hyphens', 'catalog.product--variants.read'],
    ['leading whitespace', ' catalog.products.read'],
    ['trailing whitespace', 'catalog.products.read '],
    ['interior whitespace', 'catalog.product variants.read'],
    ['non-ASCII', 'catalog.produits-écrits.read'],
    ['full-width confusable', 'catalog.ｐroducts.read'],
    ['control character', 'catalog.products.re\nad'],
    ['zero-width character', 'catalog.products.re\u200bad'],
    ['segment above 32 characters', `catalog.${'a'.repeat(33)}.read`],
    ['complete code above 98 characters', `${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(34)}`],
  ])('rejects a code with %s without normalization', (_scenario, code): void => {
    expect(() => parseIdentityPermissionCode(code)).toThrow(InvalidIdentityPermissionCodeError);
  });

  it.each([undefined, null, 7, {}, []])('rejects a non-string runtime code: %p', (code): void => {
    expect(() => parseIdentityPermissionCode(code)).toThrow(InvalidIdentityPermissionCodeError);
  });

  it('publishes the reviewed bounds', (): void => {
    expect(MAX_IDENTITY_PERMISSION_CODE_LENGTH).toBe(98);
    expect(MAX_IDENTITY_ROLE_PERMISSIONS).toBe(128);
  });

  it('uses one fixed cause-free error without exposing the rejected code', (): void => {
    const rejectedCode = 'customer.permission.SECRET-value';
    const error = captureError(() => parseIdentityPermissionCode(rejectedCode));

    expect(error).toBeInstanceOf(InvalidIdentityPermissionCodeError);
    expect(error).toMatchObject({
      message: 'Expected a canonical Identity permission code',
      name: 'InvalidIdentityPermissionCodeError',
    });
    expect(String(error)).not.toContain(rejectedCode);
    expect(JSON.stringify(error)).not.toContain(rejectedCode);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});
