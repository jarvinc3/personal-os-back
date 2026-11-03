export class UserLoggedInEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string | null,
  ) {}
}

export class NotificationCreatedEvent {
  constructor(
    public readonly userId: string,
    public readonly notificationId: string,
  ) {}
}
