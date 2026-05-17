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

export class BudgetThresholdReachedEvent {
  constructor(
    public readonly userId: string,
    public readonly budgetId: string,
    public readonly percentageUsed: number,
  ) {}
}

export class AiActionRequestedEvent {
  constructor(
    public readonly userId: string,
    public readonly actionType: string,
    public readonly payload: Record<string, unknown>,
  ) {}
}
