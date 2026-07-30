export class UserLoggedInEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string | null,
  ) {}
}

export class TransactionCreatedEvent {
  constructor(
    public readonly userId: string,
    public readonly transactionId: string,
    public readonly amount: number,
  ) {}
}

export class TransactionUpdatedEvent {
  constructor(
    public readonly userId: string,
    public readonly transactionId: string,
    public readonly amount: number,
  ) {}
}

export class BudgetThresholdReachedEvent {
  constructor(
    public readonly userId: string,
    public readonly budgetId: string,
    public readonly percentageUsed: number,
  ) {}
}

export class NotificationCreatedEvent {
  constructor(
    public readonly userId: string,
    public readonly notificationId: string,
  ) {}
}
