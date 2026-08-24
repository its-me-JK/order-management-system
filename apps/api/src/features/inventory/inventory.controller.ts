import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { dataEnvelopeSchema } from '../../platform/openapi/data-envelope.schema';
import { InsufficientInventoryError, InventoryItemNotFoundError } from './inventory.errors';
import {
  AdjustInventoryDto,
  InventoryResponseDto,
  InventorySkuParametersDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiExtraModels(InventoryResponseDto)
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  public constructor(private readonly inventory: InventoryService) {}

  @Get(':skuId')
  @ApiOperation({ operationId: 'getInventoryBySku', summary: 'Get availability by SKU' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(InventoryResponseDto, true) })
  public async bySku(@Param() parameters: InventorySkuParametersDto) {
    try {
      return { data: await this.inventory.findBySku(parameters.skuId) };
    } catch (error: unknown) {
      if (error instanceof InventoryItemNotFoundError) {
        throw new NotFoundException();
      }

      throw error;
    }
  }

  @Get()
  @ApiBearerAuth('access-token')
  @ApiOperation({ operationId: 'listInventory', summary: 'List all inventory positions' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(InventoryResponseDto, true) })
  @Roles('ADMIN')
  @UseGuards(AuthGuard, RolesGuard)
  public async list() {
    return { data: await this.inventory.list() };
  }

  @Post(':skuId/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ operationId: 'adjustInventory', summary: 'Adjust available stock' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(InventoryResponseDto) })
  @Roles('ADMIN')
  @UseGuards(AuthGuard, RolesGuard)
  public async adjust(
    @Param() parameters: InventorySkuParametersDto,
    @Body() body: AdjustInventoryDto,
  ) {
    try {
      return {
        data: await this.inventory.adjust({
          delta: body.quantityDelta,
          reason: body.reason,
          skuId: parameters.skuId,
          warehouseId: body.warehouseId,
        }),
      };
    } catch (error: unknown) {
      if (error instanceof InventoryItemNotFoundError) {
        throw new NotFoundException();
      }

      if (error instanceof InsufficientInventoryError) {
        throw new ConflictException('Adjustment would make available inventory negative');
      }

      throw error;
    }
  }
}
