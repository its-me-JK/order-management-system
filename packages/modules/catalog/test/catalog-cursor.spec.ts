import {
  InvalidCatalogCursorTimestampError,
  InvalidCatalogSkuIdError,
  parseCatalogCursorTimestamp,
  parseCatalogSkuPageCursor,
} from '../src';

const SKU_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';

describe('parseCatalogCursorTimestamp', (): void => {
  it.each([
    '1000-01-01T00:00:00.000000Z',
    '2024-02-29T23:59:59.123456Z',
    '2026-08-22T00:00:00.000000Z',
    '9999-12-31T23:59:59.999999Z',
  ])('retains the complete canonical microsecond timestamp: %s', (timestamp): void => {
    expect(parseCatalogCursorTimestamp(timestamp)).toBe(timestamp);
  });

  it.each([
    '0999-12-31T23:59:59.999999Z',
    '2023-02-29T12:00:00.000000Z',
    '2026-04-31T12:00:00.000000Z',
    '2026-00-10T12:00:00.000000Z',
    '2026-13-10T12:00:00.000000Z',
    '2026-08-00T12:00:00.000000Z',
    '2026-08-22T24:00:00.000000Z',
    '2026-08-22T23:60:00.000000Z',
    '2026-08-22T23:59:60.000000Z',
  ])('rejects an invalid calendar or clock value: %s', (timestamp): void => {
    expect(() => parseCatalogCursorTimestamp(timestamp)).toThrow(
      InvalidCatalogCursorTimestampError,
    );
  });

  it.each([
    '2026-08-22T12:34:56Z',
    '2026-08-22T12:34:56.123Z',
    '2026-08-22T12:34:56.1234567Z',
    '2026-08-22t12:34:56.123456Z',
    '2026-08-22T12:34:56.123456z',
    '2026-08-22T12:34:56.123456+00:00',
    ' 2026-08-22T12:34:56.123456Z',
    '2026-08-22T12:34:56.123456Z ',
  ])('rejects a noncanonical representation: %s', (timestamp): void => {
    expect(() => parseCatalogCursorTimestamp(timestamp)).toThrow(
      InvalidCatalogCursorTimestampError,
    );
  });
});

describe('parseCatalogSkuPageCursor', (): void => {
  it('validates and retains both decoded seek components', (): void => {
    const input = {
      createdAt: '2026-08-22T12:34:56.123456Z',
      id: SKU_ID,
    };

    expect(parseCatalogSkuPageCursor(input)).toEqual(input);
  });

  it('rejects an invalid timestamp before returning a repository cursor', (): void => {
    expect(() =>
      parseCatalogSkuPageCursor({
        createdAt: '2026-08-22T12:34:56.123Z',
        id: SKU_ID,
      }),
    ).toThrow(InvalidCatalogCursorTimestampError);
  });

  it('rejects an invalid SKU id before returning a repository cursor', (): void => {
    expect(() =>
      parseCatalogSkuPageCursor({
        createdAt: '2026-08-22T12:34:56.123456Z',
        id: 'not-a-uuid',
      }),
    ).toThrow(InvalidCatalogSkuIdError);
  });
});
