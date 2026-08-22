import { parseCatalogSkuPageCursor } from '@oms/catalog';

import {
  CatalogPublicSkuCursorEncodingError,
  decodeCatalogPublicSkuCursor,
  encodeCatalogPublicSkuCursor,
  InvalidCatalogPublicSkuCursorError,
} from './catalog-public-sku-cursor.codec';

const CREATED_AT = '2026-08-22T12:34:56.123456Z';
const SKU_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const CANONICAL_PAYLOAD = `{"v":1,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"${SKU_ID}"}`;

function encodeText(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function expectInvalid(value: unknown): void {
  let caught: unknown;

  try {
    decodeCatalogPublicSkuCursor(value);
  } catch (error: unknown) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(InvalidCatalogPublicSkuCursorError);
  expect(caught).toMatchObject({
    message: 'Invalid catalog cursor',
    name: 'InvalidCatalogPublicSkuCursorError',
  });
  expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
}

describe('Catalog public SKU cursor codec', (): void => {
  it('encodes the exact unpadded, versioned, scope-bound canonical payload', (): void => {
    const cursor = parseCatalogSkuPageCursor({
      createdAt: CREATED_AT,
      id: SKU_ID,
    });

    const encoded = encodeCatalogPublicSkuCursor(cursor);

    expect(encoded).toBe(encodeText(CANONICAL_PAYLOAD));
    expect(encoded).not.toContain('=');
  });

  it('round-trips without losing the six-digit timestamp', (): void => {
    const cursor = parseCatalogSkuPageCursor({
      createdAt: CREATED_AT,
      id: SKU_ID,
    });

    expect(decodeCatalogPublicSkuCursor(encodeCatalogPublicSkuCursor(cursor))).toEqual(cursor);
  });

  it.each([
    undefined,
    null,
    1,
    {},
    '',
    'A',
    `${encodeText(CANONICAL_PAYLOAD)}=`,
    `${encodeText(CANONICAL_PAYLOAD)}\n`,
    'A'.repeat(257),
  ])('rejects an invalid token representation without reflecting it: %p', (value): void => {
    expectInvalid(value);
  });

  it('rejects a noncanonical base64url encoding with non-zero discarded bits', (): void => {
    const canonical = Buffer.from([0]).toString('base64url');

    expect(canonical).toBe('AA');
    expectInvalid('AB');
  });

  it('rejects malformed UTF-8', (): void => {
    expectInvalid(Buffer.from([0xc3, 0x28]).toString('base64url'));
  });

  it.each([
    'not-json',
    'null',
    '[]',
    '{}',
    `{"scope":"catalog.public-skus","v":1,"createdAt":"${CREATED_AT}","id":"${SKU_ID}"}`,
    `{"v":1, "scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"${SKU_ID}"}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"${SKU_ID}","extra":true}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"${SKU_ID}","id":"${SKU_ID}"}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}"}`,
  ])('rejects malformed or noncanonical JSON: %s', (payload): void => {
    expectInvalid(encodeText(payload));
  });

  it.each([
    `{"v":2,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"${SKU_ID}"}`,
    `{"v":"1","scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"${SKU_ID}"}`,
    `{"v":1,"scope":"catalog.admin-skus","createdAt":"${CREATED_AT}","id":"${SKU_ID}"}`,
    `{"v":1,"scope":1,"createdAt":"${CREATED_AT}","id":"${SKU_ID}"}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":1,"id":"${SKU_ID}"}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":"2026-08-22T12:34:56.123Z","id":"${SKU_ID}"}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":1}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"01890F3A-8BCD-7DEF-8ABC-0123456789AB"}`,
    `{"v":1,"scope":"catalog.public-skus","createdAt":"${CREATED_AT}","id":"not-a-uuid"}`,
  ])('rejects an invalid payload contract: %s', (payload): void => {
    expectInvalid(encodeText(payload));
  });

  it('classifies an invalid trusted encode input as a fixed internal failure', (): void => {
    const invalidCursor = {
      createdAt: '2026-08-22T12:34:56.123Z',
      id: SKU_ID,
    } as unknown as Parameters<typeof encodeCatalogPublicSkuCursor>[0];

    let caught: unknown;

    try {
      encodeCatalogPublicSkuCursor(invalidCursor);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CatalogPublicSkuCursorEncodingError);
    expect(caught).not.toBeInstanceOf(InvalidCatalogPublicSkuCursorError);
    expect(caught).toMatchObject({
      message: 'Unable to encode catalog cursor',
      name: 'CatalogPublicSkuCursorEncodingError',
    });
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});
