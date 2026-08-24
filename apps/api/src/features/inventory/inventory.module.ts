import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';
import { PrismaInventoryRepository } from './infrastructure/prisma-inventory.repository';

@Module({
  controllers: [InventoryController],
  exports: [InventoryService],
  imports: [AuthModule],
  providers: [
    InventoryService,
    { provide: InventoryRepository, useClass: PrismaInventoryRepository },
  ],
})
export class InventoryModule {}
