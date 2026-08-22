import type { CatalogSkuPageCursor } from './catalog-cursor';
import type { CatalogPageSize } from './catalog-page-size';
import type { CatalogSkuId } from './catalog-sku-id';
import type { PublicSku } from './public-sku';

export type GetPublicSkuByIdQuery = Readonly<{
  skuId: CatalogSkuId;
}>;

export type GetPublicSkuByIdResult =
  | Readonly<{
      kind: 'found';
      sku: PublicSku;
    }>
  | Readonly<{
      kind: 'not-found';
    }>;

export type ListPublicSkusQuery = Readonly<{
  after: CatalogSkuPageCursor | null;
  limit: CatalogPageSize;
}>;

export type PublicSkuPageInfo =
  | Readonly<{
      nextCursor: CatalogSkuPageCursor;
    }>
  | Readonly<{
      nextCursor: null;
    }>;

export type PublicSkuPage = Readonly<{
  items: readonly PublicSku[];
  pageInfo: PublicSkuPageInfo;
}>;

/**
 * Public, read-only Catalog persistence port.
 *
 * Both methods hide an SKU unless the SKU and its owning Product are active.
 * Lists are ordered newest-first by `(created_at, id)` and `after` is an
 * exclusive cursor. Query validation belongs to the calling application use
 * case; implementations must not reinterpret malformed transport cursors.
 */
export interface CatalogReadRepository {
  getPublicSkuById(query: GetPublicSkuByIdQuery): Promise<GetPublicSkuByIdResult>;
  listPublicSkus(query: ListPublicSkusQuery): Promise<PublicSkuPage>;
}
