import type { CatalogReadRepository, GetPublicSkuByIdResult } from './catalog-read.repository';
import { parseCatalogSkuId } from './catalog-sku-id';

export type GetPublicSkuInput = Readonly<{
  skuId: string;
}>;

/** Retrieves one publicly visible SKU without depending on a delivery framework. */
export class GetPublicSku {
  public constructor(private readonly repository: CatalogReadRepository) {}

  public async execute(input: GetPublicSkuInput): Promise<GetPublicSkuByIdResult> {
    const skuId = parseCatalogSkuId(input.skuId);

    return this.repository.getPublicSkuById({ skuId });
  }
}
