import { Injectable } from '@nestjs/common';

import { NotificationRepository, type NotificationView } from './notification.repository';

@Injectable()
export class NotificationService {
  public constructor(private readonly repository: NotificationRepository) {}

  public list(userId: string): Promise<readonly NotificationView[]> {
    return this.repository.list(userId);
  }

  public markRead(userId: string, notificationId: string): Promise<NotificationView> {
    return this.repository.markRead(userId, notificationId);
  }
}
