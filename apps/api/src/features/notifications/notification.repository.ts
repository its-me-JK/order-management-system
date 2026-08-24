export interface NotificationView {
  readonly createdAt: string;
  readonly id: string;
  readonly message: string;
  readonly readAt: string | null;
  readonly title: string;
  readonly type: string;
}

export abstract class NotificationRepository {
  public abstract list(userId: string): Promise<readonly NotificationView[]>;
  public abstract markRead(userId: string, notificationId: string): Promise<NotificationView>;
}
