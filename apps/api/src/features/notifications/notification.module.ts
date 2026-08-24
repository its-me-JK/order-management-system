import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaNotificationRepository } from './infrastructure/prisma-notification.repository';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

@Module({
  controllers: [NotificationController],
  imports: [AuthModule],
  providers: [
    NotificationService,
    { provide: NotificationRepository, useClass: PrismaNotificationRepository },
  ],
})
export class NotificationModule {}
