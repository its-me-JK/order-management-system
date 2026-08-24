import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthPrincipal } from '../auth/auth.contracts';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { dataEnvelopeSchema } from '../../platform/openapi/data-envelope.schema';
import { CreateOrderDto, OrderParametersDto, PaymentParametersDto } from './order.dto';
import { OrderResponseDto, PaymentResponseDto } from './order.dto';
import {
  OrderCurrencyMismatchError,
  OrderIdempotencyConflictError,
  OrderInventoryUnavailableError,
  OrderNotFoundError,
  OrderTransitionNotAllowedError,
  PaymentNotFoundError,
} from './order.errors';
import type { OrderActor } from './order.repository';
import { OrderService } from './order.service';

function actor(principal: AuthPrincipal): OrderActor {
  return { id: principal.userId, role: principal.role };
}

function idempotencyKey(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/u.test(value)) {
    throw new BadRequestException('A valid Idempotency-Key header is required');
  }

  return value;
}

function translateOrderError(error: unknown): never {
  if (error instanceof OrderNotFoundError || error instanceof PaymentNotFoundError) {
    throw new NotFoundException();
  }

  if (
    error instanceof OrderInventoryUnavailableError ||
    error instanceof OrderCurrencyMismatchError ||
    error instanceof OrderIdempotencyConflictError ||
    error instanceof OrderTransitionNotAllowedError
  ) {
    throw new ConflictException(error.message);
  }

  throw error;
}

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@ApiExtraModels(OrderResponseDto, PaymentResponseDto)
@UseGuards(AuthGuard)
@Controller({ path: 'orders', version: '1' })
export class OrderController {
  public constructor(private readonly orders: OrderService) {}

  @Post()
  @ApiHeader({
    description: 'Unique key for safely retrying this order request.',
    name: 'Idempotency-Key',
    required: true,
  })
  @ApiOperation({ operationId: 'createOrder', summary: 'Create an order' })
  @ApiCreatedResponse({ schema: dataEnvelopeSchema(OrderResponseDto) })
  public async create(
    @CurrentUser() principal: AuthPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateOrderDto,
  ) {
    try {
      return {
        data: await this.orders.create({
          actor: actor(principal),
          idempotencyKey: idempotencyKey(key),
          items: body.items,
          shippingAddress: body.shippingAddress,
        }),
      };
    } catch (error: unknown) {
      return translateOrderError(error);
    }
  }

  @Get()
  @ApiOperation({ operationId: 'listOrders', summary: 'List visible orders' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(OrderResponseDto, true) })
  public async list(@CurrentUser() principal: AuthPrincipal) {
    return { data: await this.orders.list(actor(principal)) };
  }

  @Get(':orderId')
  @ApiOperation({ operationId: 'getOrder', summary: 'Get an order' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(OrderResponseDto) })
  public async get(
    @CurrentUser() principal: AuthPrincipal,
    @Param() parameters: OrderParametersDto,
  ) {
    try {
      return { data: await this.orders.find(actor(principal), parameters.orderId) };
    } catch (error: unknown) {
      return translateOrderError(error);
    }
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'cancelOrder', summary: 'Cancel an eligible order' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(OrderResponseDto) })
  public async cancel(
    @CurrentUser() principal: AuthPrincipal,
    @Param() parameters: OrderParametersDto,
  ) {
    try {
      return { data: await this.orders.cancel(actor(principal), parameters.orderId) };
    } catch (error: unknown) {
      return translateOrderError(error);
    }
  }

  @Get(':orderId/payment')
  @ApiOperation({ operationId: 'getOrderPayment', summary: 'Get payment status for an order' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(PaymentResponseDto) })
  public async payment(
    @CurrentUser() principal: AuthPrincipal,
    @Param() parameters: OrderParametersDto,
  ) {
    try {
      return { data: await this.orders.payment(actor(principal), parameters.orderId) };
    } catch (error: unknown) {
      return translateOrderError(error);
    }
  }
}

@ApiTags('Order Administration')
@ApiBearerAuth('access-token')
@ApiExtraModels(OrderResponseDto)
@Roles('ADMIN')
@UseGuards(AuthGuard, RolesGuard)
@Controller({ path: 'admin/orders', version: '1' })
export class AdminOrderController {
  public constructor(private readonly orders: OrderService) {}

  @Post(':orderId/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'shipOrder', summary: 'Mark an authorized order as shipped' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(OrderResponseDto) })
  public async ship(@Param() parameters: OrderParametersDto) {
    try {
      return { data: await this.orders.ship(parameters.orderId) };
    } catch (error: unknown) {
      return translateOrderError(error);
    }
  }

  @Post(':orderId/deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'deliverOrder', summary: 'Mark a shipped order as delivered' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(OrderResponseDto) })
  public async deliver(@Param() parameters: OrderParametersDto) {
    try {
      return { data: await this.orders.deliver(parameters.orderId) };
    } catch (error: unknown) {
      return translateOrderError(error);
    }
  }
}

@ApiTags('Payments')
@ApiBearerAuth('access-token')
@ApiExtraModels(PaymentResponseDto)
@Roles('ADMIN')
@UseGuards(AuthGuard, RolesGuard)
@Controller({ path: 'payments', version: '1' })
export class PaymentController {
  public constructor(private readonly orders: OrderService) {}

  @Post(':paymentId/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'refundPayment', summary: 'Refund an authorized payment' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(PaymentResponseDto) })
  public async refund(@Param() parameters: PaymentParametersDto) {
    try {
      return { data: await this.orders.refund(parameters.paymentId) };
    } catch (error: unknown) {
      return translateOrderError(error);
    }
  }
}
