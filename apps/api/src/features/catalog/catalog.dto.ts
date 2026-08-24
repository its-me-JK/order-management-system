import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const CATALOG_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
const SKU_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9._-]{0,62}[A-Z0-9])?$/u;
const PRICE_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const LIMIT_PATTERN = /^(?:[1-9]|[1-9]\d|100)$/u;

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export class CatalogIdParametersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly id!: string;
}

export class CatalogProductIdParametersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly productId!: string;
}

export class CatalogCollectionQueryDto {
  @ApiPropertyOptional({ default: '50', pattern: LIMIT_PATTERN.source, type: String })
  @IsOptional()
  @IsString()
  @Matches(LIMIT_PATTERN)
  public readonly limit?: string;
}

export class SkuCollectionQueryDto extends CatalogCollectionQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  public readonly productId?: string;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones', maxLength: 160, minLength: 2 })
  @IsString()
  @Length(2, 160)
  public readonly name!: string;

  @ApiProperty({ maxLength: 500, minLength: 1 })
  @IsString()
  @Length(1, 500)
  public readonly description!: string;

  @ApiPropertyOptional({ default: 'DRAFT', enum: CATALOG_STATUSES })
  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  public readonly status?: CatalogStatus;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ maxLength: 160, minLength: 2 })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  public readonly name?: string;

  @ApiPropertyOptional({ maxLength: 500, minLength: 1 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  public readonly description?: string;

  @ApiPropertyOptional({ enum: CATALOG_STATUSES })
  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  public readonly status?: CatalogStatus;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public readonly version!: number;
}

export class CreateSkuDto {
  @ApiProperty({ example: 'HEADPHONES-BLK', maxLength: 64, minLength: 2 })
  @IsString()
  @Length(2, 64)
  @Matches(SKU_CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ example: 'Wireless Headphones — Black', maxLength: 160, minLength: 2 })
  @IsString()
  @Length(2, 160)
  public readonly name!: string;

  @ApiProperty({ example: '2499.00', pattern: PRICE_PATTERN.source })
  @IsString()
  @Matches(PRICE_PATTERN)
  public readonly price!: string;

  @ApiProperty({ example: 'INR', pattern: CURRENCY_PATTERN.source })
  @IsString()
  @Matches(CURRENCY_PATTERN)
  public readonly currency!: string;

  @ApiPropertyOptional({ default: 'DRAFT', enum: CATALOG_STATUSES })
  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  public readonly status?: CatalogStatus;
}

export class UpdateSkuDto {
  @ApiPropertyOptional({ maxLength: 160, minLength: 2 })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  public readonly name?: string;

  @ApiPropertyOptional({ pattern: PRICE_PATTERN.source })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN)
  public readonly price?: string;

  @ApiPropertyOptional({ pattern: CURRENCY_PATTERN.source })
  @IsOptional()
  @IsString()
  @Matches(CURRENCY_PATTERN)
  public readonly currency?: string;

  @ApiPropertyOptional({ enum: CATALOG_STATUSES })
  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  public readonly status?: CatalogStatus;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public readonly version!: number;
}
