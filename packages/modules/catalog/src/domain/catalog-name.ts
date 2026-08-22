const CATALOG_NAME_CONTROL_PATTERN = /\p{Cc}/u;
const CATALOG_NAME_EDGE_WHITESPACE_PATTERN = /^\p{White_Space}|\p{White_Space}$/u;

declare const catalogNameBrand: unique symbol;

/** An already-normalized Catalog display name safe for utf8mb4 persistence. */
export type CatalogName = string & {
  readonly [catalogNameBrand]: true;
};

export const MAX_CATALOG_NAME_CODE_POINTS = 160;

export class InvalidCatalogNameError extends Error {
  public constructor() {
    super('Expected a valid NFC-normalized Catalog name');
    this.name = 'InvalidCatalogNameError';
  }
}

function hasValidScalarLength(value: string): boolean {
  let codePointCount = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      codePoint === undefined ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      ++codePointCount > MAX_CATALOG_NAME_CODE_POINTS
    ) {
      return false;
    }
  }

  return codePointCount >= 1;
}

/** Rejects invalid text rather than silently trimming or normalizing it. */
export function parseCatalogName(value: unknown): CatalogName {
  if (
    typeof value !== 'string' ||
    !hasValidScalarLength(value) ||
    value.normalize('NFC') !== value ||
    CATALOG_NAME_CONTROL_PATTERN.test(value) ||
    CATALOG_NAME_EDGE_WHITESPACE_PATTERN.test(value)
  ) {
    throw new InvalidCatalogNameError();
  }

  return value as CatalogName;
}
