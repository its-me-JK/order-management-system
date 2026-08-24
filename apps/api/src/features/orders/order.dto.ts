import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderParametersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly orderId!: string;
}

export class PaymentParametersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly paymentId!: string;
}

export class CreateOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly skuId!: string;

  @ApiProperty({ maximum: 100, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public readonly quantity!: number;
}

export class ShippingAddressDto {
  @ApiProperty({ example: '42 Residency Road', maxLength: 160, minLength: 3 })
  @IsString()
  @Length(3, 160)
  public readonly line1!: string;

  @ApiProperty({ example: 'Bengaluru', maxLength: 80, minLength: 2 })
  @IsString()
  @Length(2, 80)
  public readonly city!: string;

  @ApiProperty({ example: 'Karnataka', maxLength: 80, minLength: 2 })
  @IsString()
  @Length(2, 80)
  public readonly state!: string;

  @ApiProperty({ example: '560025', maxLength: 20, minLength: 3 })
  @IsString()
  @Length(3, 20)
  public readonly postalCode!: string;

  @ApiProperty({ example: 'IN', maxLength: 2, minLength: 2, pattern: '^[A-Z]{2}$' })
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/u)
  public readonly country!: string;
}

export class CreateOrderDto {
  @ApiProperty({ maxItems: 25, minItems: 1, type: () => [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique((item: CreateOrderItemDto): string => item.skuId)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  public readonly items!: readonly CreateOrderItemDto[];

  @ApiProperty({ type: () => ShippingAddressDto })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  public readonly shippingAddress!: ShippingAddressDto;
}

export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty({ example: '2499.00' })
  public readonly lineTotal!: string;

  @ApiProperty({ minimum: 1 })
  public readonly quantity!: number;

  @ApiProperty()
  public readonly skuCode!: string;

  @ApiProperty({ format: 'uuid' })
  public readonly skuId!: string;

  @ApiProperty()
  public readonly skuName!: string;

  @ApiProperty({ example: '2499.00' })
  public readonly unitPrice!: string;
}

export class OrderTimelineResponseDto {
  @ApiProperty({ format: 'date-time' })
  public readonly createdAt!: string;

  @ApiProperty({ nullable: true })
  public readonly fromStatus!: string | null;

  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty({ nullable: true })
  public readonly reason!: string | null;

  @ApiProperty()
  public readonly toStatus!: string;
}

export class PaymentResponseDto {
  @ApiProperty({ example: '2499.00' })
  public readonly amount!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  public readonly authorizedAt!: string | null;

  @ApiProperty({ example: 'INR' })
  public readonly currency!: string;

  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty()
  public readonly provider!: string;

  @ApiProperty({ nullable: true })
  public readonly providerReference!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  public readonly refundedAt!: string | null;

  @ApiProperty()
  public readonly status!: string;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'date-time' })
  public readonly createdAt!: string;

  @ApiProperty({ example: 'INR' })
  public readonly currency!: string;

  @ApiProperty({ format: 'email' })
  public readonly customerEmail!: string;

  @ApiProperty()
  public readonly customerName!: string;

  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty({ type: () => [OrderItemResponseDto] })
  public readonly items!: readonly OrderItemResponseDto[];

  @ApiProperty()
  public readonly orderNumber!: string;

  @ApiProperty({ nullable: true, type: () => PaymentResponseDto })
  public readonly payment!: PaymentResponseDto | null;

  @ApiProperty()
  public readonly paymentStatus!: string;

  @ApiProperty({ type: () => ShippingAddressDto })
  public readonly shippingAddress!: ShippingAddressDto;

  @ApiProperty()
  public readonly status!: string;

  @ApiProperty({ type: () => [OrderTimelineResponseDto] })
  public readonly timeline!: readonly OrderTimelineResponseDto[];

  @ApiProperty({ example: '2499.00' })
  public readonly total!: string;

  @ApiProperty({ format: 'date-time' })
  public readonly updatedAt!: string;
}
