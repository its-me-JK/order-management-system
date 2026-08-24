import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { dataEnvelopeSchema } from '../../platform/openapi/data-envelope.schema';
import {
  CatalogCollectionQueryDto,
  CatalogIdParametersDto,
  CatalogProductIdParametersDto,
  CreateProductDto,
  CreateSkuDto,
  SkuCollectionQueryDto,
  UpdateProductDto,
  UpdateSkuDto,
} from './catalog.dto';
import { CatalogProductSummaryResponse, ProductResponse, SkuResponse } from './catalog.responses';
import { CatalogService } from './catalog.service';

@Controller({ path: 'catalog', version: '1' })
@ApiTags('Catalog')
@ApiExtraModels(ProductResponse, SkuResponse, CatalogProductSummaryResponse)
export class CatalogController {
  public constructor(private readonly catalogService: CatalogService) {}

  @Get('products')
  @ApiOperation({ operationId: 'listCatalogProducts' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(ProductResponse, true) })
  public async listProducts(
    @Query() query: CatalogCollectionQueryDto,
  ): Promise<Readonly<{ data: readonly ProductResponse[] }>> {
    return { data: await this.catalogService.listProducts(query) };
  }

  @Get('skus')
  @ApiOperation({ operationId: 'listCatalogSkus' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(SkuResponse, true) })
  public async listSkus(
    @Query() query: SkuCollectionQueryDto,
  ): Promise<Readonly<{ data: readonly SkuResponse[] }>> {
    return { data: await this.catalogService.listSkus(query) };
  }

  @Get('skus/:id')
  @ApiOperation({ operationId: 'getCatalogSku' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(SkuResponse) })
  public async getSku(
    @Param() parameters: CatalogIdParametersDto,
  ): Promise<Readonly<{ data: SkuResponse }>> {
    return { data: await this.catalogService.getSku(parameters.id) };
  }
}

@Controller({ path: 'admin', version: '1' })
@ApiTags('Catalog Administration')
@ApiBearerAuth('access-token')
@ApiExtraModels(ProductResponse, SkuResponse, CatalogProductSummaryResponse)
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminCatalogController {
  public constructor(private readonly catalogService: CatalogService) {}

  @Post('products')
  @ApiOperation({ operationId: 'createCatalogProduct' })
  @ApiCreatedResponse({ schema: dataEnvelopeSchema(ProductResponse) })
  public async createProduct(
    @Body() body: CreateProductDto,
  ): Promise<Readonly<{ data: ProductResponse }>> {
    return { data: await this.catalogService.createProduct(body) };
  }

  @Patch('products/:id')
  @ApiOperation({ operationId: 'updateCatalogProduct' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(ProductResponse) })
  public async updateProduct(
    @Param() parameters: CatalogIdParametersDto,
    @Body() body: UpdateProductDto,
  ): Promise<Readonly<{ data: ProductResponse }>> {
    return { data: await this.catalogService.updateProduct(parameters.id, body) };
  }

  @Post('products/:productId/skus')
  @ApiOperation({ operationId: 'createCatalogSku' })
  @ApiCreatedResponse({ schema: dataEnvelopeSchema(SkuResponse) })
  public async createSku(
    @Param() parameters: CatalogProductIdParametersDto,
    @Body() body: CreateSkuDto,
  ): Promise<Readonly<{ data: SkuResponse }>> {
    return { data: await this.catalogService.createSku(parameters.productId, body) };
  }

  @Patch('skus/:id')
  @ApiOperation({ operationId: 'updateCatalogSku' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(SkuResponse) })
  public async updateSku(
    @Param() parameters: CatalogIdParametersDto,
    @Body() body: UpdateSkuDto,
  ): Promise<Readonly<{ data: SkuResponse }>> {
    return { data: await this.catalogService.updateSku(parameters.id, body) };
  }
}
