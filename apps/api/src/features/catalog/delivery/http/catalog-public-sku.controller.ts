import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CatalogReadUnavailableError,
  GetPublicSku,
  InvalidCatalogCursorTimestampError,
  InvalidCatalogPageSizeError,
  InvalidCatalogSkuIdError,
  ListPublicSkus,
  type PublicSku,
} from '@oms/catalog';

import {
  decodeCatalogPublicSkuCursor,
  encodeCatalogPublicSkuCursor,
  InvalidCatalogPublicSkuCursorError,
} from './catalog-public-sku-cursor.codec';
import {
  CatalogPublicSkuPathParametersDto,
  ListCatalogPublicSkusQueryDto,
} from './catalog-public-sku.request.dto';
import {
  ApiCatalogGetPublicSkuOperation,
  ApiCatalogListPublicSkusOperation,
} from './catalog-public-sku.openapi';
import { CATALOG_PUBLIC_SKU_LIMIT_PATTERN } from './catalog-public-sku.openapi.schemas';

const PUBLIC_CATALOG_CACHE_CONTROL = 'no-store';
const catalogPublicSkuLimitPattern = new RegExp(CATALOG_PUBLIC_SKU_LIMIT_PATTERN, 'u');

export type CatalogPublicSkuResourceResponse = Readonly<{
  data: PublicSku;
}>;

export type CatalogPublicSkuCollectionResponse = Readonly<{
  data: readonly PublicSku[];
  pageInfo: Readonly<{
    nextCursor: string | null;
  }>;
}>;

function toCatalogPublicSkuResponse(sku: PublicSku): PublicSku {
  return {
    id: sku.id,
    code: sku.code,
    name: sku.name,
    product: {
      id: sku.product.id,
      name: sku.product.name,
    },
  };
}

function parseCatalogPublicSkuLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !catalogPublicSkuLimitPattern.test(value)) {
    throw new BadRequestException();
  }

  return Number(value);
}

function translateCatalogPublicReadError(error: unknown): never {
  if (
    error instanceof InvalidCatalogPublicSkuCursorError ||
    error instanceof InvalidCatalogCursorTimestampError ||
    error instanceof InvalidCatalogPageSizeError ||
    error instanceof InvalidCatalogSkuIdError
  ) {
    throw new BadRequestException();
  }

  if (error instanceof CatalogReadUnavailableError) {
    throw new ServiceUnavailableException(undefined, { cause: error });
  }

  throw error;
}

@ApiTags('Catalog')
@Controller({ path: 'catalog/skus', version: '1' })
export class CatalogPublicSkuController {
  public constructor(
    private readonly getPublicSku: GetPublicSku,
    private readonly listPublicSkus: ListPublicSkus,
  ) {}

  @Get()
  @Header('Cache-Control', PUBLIC_CATALOG_CACHE_CONTROL)
  @ApiCatalogListPublicSkusOperation()
  public async list(
    @Query() query: ListCatalogPublicSkusQueryDto,
  ): Promise<CatalogPublicSkuCollectionResponse> {
    try {
      const after = query.cursor === undefined ? null : decodeCatalogPublicSkuCursor(query.cursor);
      const limit = parseCatalogPublicSkuLimit(query.limit);
      const page = await this.listPublicSkus.execute(
        limit === undefined ? { after } : { after, limit },
      );

      return {
        data: page.items.map(toCatalogPublicSkuResponse),
        pageInfo: {
          nextCursor:
            page.pageInfo.nextCursor === null
              ? null
              : encodeCatalogPublicSkuCursor(page.pageInfo.nextCursor),
        },
      };
    } catch (error: unknown) {
      return translateCatalogPublicReadError(error);
    }
  }

  @Get(':skuId')
  @Header('Cache-Control', PUBLIC_CATALOG_CACHE_CONTROL)
  @ApiCatalogGetPublicSkuOperation()
  public async get(
    @Param() parameters: CatalogPublicSkuPathParametersDto,
  ): Promise<CatalogPublicSkuResourceResponse> {
    try {
      const result = await this.getPublicSku.execute({ skuId: parameters.skuId });

      if (result.kind === 'not-found') {
        throw new NotFoundException();
      }

      return { data: toCatalogPublicSkuResponse(result.sku) };
    } catch (error: unknown) {
      return translateCatalogPublicReadError(error);
    }
  }
}
