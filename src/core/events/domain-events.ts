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
    public readonly status: string = 'CONFIRMED',
    public readonly source: string = 'MANUAL',
    public readonly eventId?: string,
  ) {}
}

export class TransactionUpdatedEvent {
  constructor(
    public readonly userId: string,
    public readonly transactionId: string,
    public readonly amount: number,
    public readonly status: string = 'CONFIRMED',
    public readonly eventId?: string,
  ) {}
}

export class BudgetThresholdReachedEvent {
  constructor(
    public readonly userId: string,
    public readonly budgetId: string,
    public readonly percentageUsed: number,
    public readonly eventId?: string,
    public readonly alertId?: string,
  ) {}
}

export class NotificationCreatedEvent {
  constructor(
    public readonly userId: string,
    public readonly notificationId: string,
  ) {}
}

export class FinanceEmailSyncCompletedEvent {
  constructor(
    public readonly userId: string,
    public readonly sourceId: string,
    public readonly emailsScanned: number,
    public readonly transactionsNew: number,
    public readonly transactionIds: string[],
    public readonly countsByStatus: Record<string, number>,
    public readonly eventId?: string,
  ) {}
}

export class FinanceTransferCreatedEvent {
  constructor(
    public readonly userId: string,
    public readonly transferGroupId: string,
    public readonly debitId: string,
    public readonly creditId: string,
    public readonly amount: number,
    public readonly eventId?: string,
  ) {}
}
