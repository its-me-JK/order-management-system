import { parseCatalogSkuPageCursor, type CatalogSkuPageCursorInput } from './catalog-cursor';
import { parseCatalogPageSize } from './catalog-page-size';
import type { CatalogReadRepository, PublicSkuPage } from './catalog-read.repository';

export type ListPublicSkusInput = Readonly<{
  after?: CatalogSkuPageCursorInput | null;
  limit?: number;
}>;

/** Lists publicly visible SKUs using a validated, bounded seek query. */
export class ListPublicSkus {
  public constructor(private readonly repository: CatalogReadRepository) {}

  public async execute(input: ListPublicSkusInput = {}): Promise<PublicSkuPage> {
    const after =
      input.after === undefined || input.after === null
        ? null
        : parseCatalogSkuPageCursor(input.after);
    const limit = parseCatalogPageSize(input.limit);

    return this.repository.listPublicSkus({ after, limit });
  }
}
