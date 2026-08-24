import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@oms/database/prisma';

import { DATABASE_CLIENT } from '../../../platform/database/database.tokens';
import { NotificationNotFoundError } from '../notification.errors';
import { NotificationRepository, type NotificationView } from '../notification.repository';

function toView(notification: {
  createdAt: Date;
  id: string;
  message: string;
  readAt: Date | null;
  title: string;
  type: string;
}): NotificationView {
  return {
    createdAt: notification.createdAt.toISOString(),
    id: notification.id,
    message: notification.message,
    readAt: notification.readAt?.toISOString() ?? null,
    title: notification.title,
    type: notification.type,
  };
}

@Injectable()
export class PrismaNotificationRepository extends NotificationRepository {
  public constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: PrismaClient,
  ) {
    super();
  }

  public async list(userId: string): Promise<readonly NotificationView[]> {
    const notifications = await this.client.notificationRecord.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      where: { userId },
    });

    return notifications.map(toView);
  }

  public async markRead(userId: string, notificationId: string): Promise<NotificationView> {
    const updated = await this.client.notificationRecord.updateMany({
      data: { readAt: new Date() },
      where: { id: notificationId, userId },
    });

    if (updated.count !== 1) {
      throw new NotificationNotFoundError();
    }

    const notification = await this.client.notificationRecord.findUnique({
      where: { id: notificationId },
    });

    if (notification === null) {
      throw new NotificationNotFoundError();
    }

    return toView(notification);
  }
}
