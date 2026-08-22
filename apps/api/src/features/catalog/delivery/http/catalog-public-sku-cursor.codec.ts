import { parseCatalogSkuPageCursor, type CatalogSkuPageCursor } from '@oms/catalog';

const CATALOG_PUBLIC_SKU_CURSOR_VERSION = 1;
const CATALOG_PUBLIC_SKU_CURSOR_SCOPE = 'catalog.public-skus';
export const MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH = 256;
const UNPADDED_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CURSOR_PAYLOAD_KEYS = ['v', 'scope', 'createdAt', 'id'] as const;

type CatalogPublicSkuCursorPayload = Readonly<{
  createdAt: string;
  id: string;
  scope: typeof CATALOG_PUBLIC_SKU_CURSOR_SCOPE;
  v: typeof CATALOG_PUBLIC_SKU_CURSOR_VERSION;
}>;

/** The single safe outcome for every invalid public Catalog cursor. */
export class InvalidCatalogPublicSkuCursorError extends Error {
  public constructor() {
    super('Invalid catalog cursor');
    this.name = 'InvalidCatalogPublicSkuCursorError';
  }
}

/** Fixed internal failure for an invalid trusted cursor passed to the encoder. */
export class CatalogPublicSkuCursorEncodingError extends Error {
  public constructor() {
    super('Unable to encode catalog cursor');
    this.name = 'CatalogPublicSkuCursorEncodingError';
  }
}

function invalidCursor(): never {
  throw new InvalidCatalogPublicSkuCursorError();
}

function cursorEncodingFailure(): never {
  throw new CatalogPublicSkuCursorEncodingError();
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCanonicalPayloadKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);

  return (
    keys.length === CURSOR_PAYLOAD_KEYS.length &&
    keys.every((key, index) => key === CURSOR_PAYLOAD_KEYS[index])
  );
}

function serializeCursor(cursor: CatalogSkuPageCursor): string {
  const payload: CatalogPublicSkuCursorPayload = {
    v: CATALOG_PUBLIC_SKU_CURSOR_VERSION,
    scope: CATALOG_PUBLIC_SKU_CURSOR_SCOPE,
    createdAt: cursor.createdAt,
    id: cursor.id,
  };

  return JSON.stringify(payload);
}

function parsePayload(value: unknown): CatalogSkuPageCursor {
  if (!isRecord(value) || !hasCanonicalPayloadKeys(value)) {
    return invalidCursor();
  }

  if (
    value['v'] !== CATALOG_PUBLIC_SKU_CURSOR_VERSION ||
    value['scope'] !== CATALOG_PUBLIC_SKU_CURSOR_SCOPE ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['id'] !== 'string'
  ) {
    return invalidCursor();
  }

  return parseCatalogSkuPageCursor({
    createdAt: value['createdAt'],
    id: value['id'],
  });
}

/** Encodes a validated seek position into the one canonical public HTTP token. */
export function encodeCatalogPublicSkuCursor(cursor: CatalogSkuPageCursor): string {
  try {
    const validatedCursor = parseCatalogSkuPageCursor(cursor);
    const encoded = Buffer.from(serializeCursor(validatedCursor), 'utf8').toString('base64url');

    if (encoded.length > MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH) {
      return cursorEncodingFailure();
    }

    return encoded;
  } catch {
    return cursorEncodingFailure();
  }
}

/**
 * Decodes an untrusted query value only when its bytes and JSON are canonical.
 *
 * Node's base64 decoder and `JSON.parse` are intentionally permissive. The
 * byte-level and serialized-payload equality checks make their accepted input
 * surface exactly the cursor format owned by this API.
 */
export function decodeCatalogPublicSkuCursor(value: unknown): CatalogSkuPageCursor {
  try {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH ||
      !UNPADDED_BASE64URL_PATTERN.test(value)
    ) {
      return invalidCursor();
    }

    const bytes = Buffer.from(value, 'base64url');

    if (bytes.length === 0 || bytes.toString('base64url') !== value) {
      return invalidCursor();
    }

    const serializedPayload = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const cursor = parsePayload(parseJson(serializedPayload));

    if (serializeCursor(cursor) !== serializedPayload) {
      return invalidCursor();
    }

    return cursor;
  } catch {
    return invalidCursor();
  }
}
