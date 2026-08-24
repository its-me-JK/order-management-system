import { ApiProperty } from '@nestjs/swagger';

type DecimalValue = Readonly<{ toFixed(fractionDigits: number): string }>;

export class ProductResponse {
  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty()
  public readonly name!: string;

  @ApiProperty()
  public readonly description!: string;

  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  public readonly status!: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

  @ApiProperty({ minimum: 1 })
  public readonly version!: number;

  @ApiProperty({ format: 'date-time' })
  public readonly createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public readonly updatedAt!: string;
}

export class CatalogProductSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty()
  public readonly name!: string;
}

export class SkuResponse {
  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty()
  public readonly code!: string;

  @ApiProperty()
  public readonly name!: string;

  @ApiProperty()
  public readonly description!: string;

  @ApiProperty({ example: '2499.00', pattern: '^(?:0|[1-9]\\d*)\\.\\d{2}$' })
  public readonly price!: string;

  @ApiProperty({ example: 'INR', pattern: '^[A-Z]{3}$' })
  public readonly currency!: string;

  @ApiProperty({ minimum: 0 })
  public readonly available!: number;

  @ApiProperty({ minimum: 1 })
  public readonly version!: number;

  @ApiProperty({ type: () => CatalogProductSummaryResponse })
  public readonly product!: CatalogProductSummaryResponse;
}

export function mapProduct(record: {
  id: string;
  name: string;
  description: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): ProductResponse {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapSku(record: {
  id: string;
  code: string;
  name: string;
  price: DecimalValue;
  currency: string;
  version: number;
  product: { id: string; name: string; description: string };
  inventory: readonly { available: number }[];
}): SkuResponse {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    description: record.product.description,
    price: record.price.toFixed(2),
    currency: record.currency,
    available: record.inventory.reduce((total, item) => total + item.available, 0),
    version: record.version,
    product: {
      id: record.product.id,
      name: record.product.name,
    },
  };
}
