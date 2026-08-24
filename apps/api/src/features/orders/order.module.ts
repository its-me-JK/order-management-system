import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository';
import { AdminOrderController, OrderController, PaymentController } from './order.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  controllers: [OrderController, AdminOrderController, PaymentController],
  imports: [AuthModule],
  providers: [OrderService, { provide: OrderRepository, useClass: PrismaOrderRepository }],
})
export class OrderModule {}
