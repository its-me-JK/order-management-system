import { IsOptional, IsString, Length, Matches } from 'class-validator';

import { MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH } from './catalog-public-sku-cursor.codec';
import {
  CATALOG_PUBLIC_SKU_CURSOR_PATTERN,
  CATALOG_PUBLIC_SKU_ID_PATTERN,
  CATALOG_PUBLIC_SKU_LIMIT_PATTERN,
} from './catalog-public-sku.openapi.schemas';

const catalogPublicSkuIdPattern = new RegExp(CATALOG_PUBLIC_SKU_ID_PATTERN, 'u');
const catalogPublicSkuLimitPattern = new RegExp(CATALOG_PUBLIC_SKU_LIMIT_PATTERN, 'u');
const catalogPublicSkuCursorPattern = new RegExp(CATALOG_PUBLIC_SKU_CURSOR_PATTERN, 'u');

/** Exact path parameters accepted by the public Catalog resource route. */
export class CatalogPublicSkuPathParametersDto {
  @IsString()
  @Matches(catalogPublicSkuIdPattern)
  public readonly skuId!: string;
}

/** Exact query parameters accepted by the public Catalog collection route. */
export class ListCatalogPublicSkusQueryDto {
  @IsOptional()
  @IsString()
  @Matches(catalogPublicSkuLimitPattern)
  public readonly limit?: string;

  @IsOptional()
  @IsString()
  @Length(1, MAX_CATALOG_PUBLIC_SKU_CURSOR_LENGTH)
  @Matches(catalogPublicSkuCursorPattern)
  public readonly cursor?: string;
}
