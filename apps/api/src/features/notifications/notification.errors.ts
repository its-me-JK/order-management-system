export class NotificationNotFoundError extends Error {
  public constructor() {
    super('Notification was not found');
    this.name = 'NotificationNotFoundError';
  }
}
