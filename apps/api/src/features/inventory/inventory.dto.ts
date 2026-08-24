import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InventorySkuParametersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly skuId!: string;
}

export class AdjustInventoryDto {
  @ApiProperty({ example: 25, maximum: 1_000_000, minimum: -1_000_000 })
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  public readonly quantityDelta!: number;

  @ApiProperty({ example: 'Cycle count correction', maxLength: 100, minLength: 3 })
  @IsString()
  @Length(3, 100)
  public readonly reason!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly warehouseId!: string;
}

export class InventoryResponseDto {
  @ApiProperty({ minimum: 0 })
  public readonly available!: number;

  @ApiProperty({ minimum: 0 })
  public readonly onHand!: number;

  @ApiProperty({ minimum: 0 })
  public readonly reserved!: number;

  @ApiProperty()
  public readonly skuCode!: string;

  @ApiProperty({ format: 'uuid' })
  public readonly skuId!: string;

  @ApiProperty()
  public readonly skuName!: string;

  @ApiProperty({ minimum: 1 })
  public readonly version!: number;

  @ApiProperty()
  public readonly warehouseCode!: string;

  @ApiProperty({ format: 'uuid' })
  public readonly warehouseId!: string;

  @ApiProperty()
  public readonly warehouseName!: string;
}
