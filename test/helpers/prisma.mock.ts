type MockFn = jest.Mock<any, any>;

export type PrismaMock = {
  user: {
    findUnique: MockFn;
    update: MockFn;
    delete: MockFn;
  };
  module: {
    findUnique: MockFn;
  };
  userModule: {
    findUnique: MockFn;
    findFirst: MockFn;
    upsert: MockFn;
  };
  notification: {
    create: MockFn;
    update: MockFn;
    findMany: MockFn;
    count: MockFn;
    updateMany: MockFn;
  };
  pushToken: {
    upsert: MockFn;
    updateMany: MockFn;
    findMany: MockFn;
  };
  aiMessage: {
    create: MockFn;
  };
  finAccount: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
    updateMany: MockFn;
    count: MockFn;
  };
  finInstitution: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
  };
  finExchangeRate: {
    findMany: MockFn;
  };
  finTransaction: {
    findMany: MockFn;
    findFirst: MockFn;
    count: MockFn;
    create: MockFn;
    groupBy: MockFn;
  };
  finCard: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    count: MockFn;
  };
  finLoan: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    count: MockFn;
  };
  finReceivable: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
  };
  finCardBalance: {
    findMany: MockFn;
  };
  finCategory: {
    findMany: MockFn;
    findFirst: MockFn;
  };
  finBudget: {
    findMany: MockFn;
    findFirst: MockFn;
    count: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
  };
  finEmailSource: {
    findMany: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    create: MockFn;
    updateMany: MockFn;
    count: MockFn;
  };
  finEmailConnection: {
    findUnique: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
  };
  finEmailMessage: {
    findMany: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    upsert: MockFn;
  };
  domainEventOutbox: {
    create: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    updateMany: MockFn;
    update: MockFn;
  };
  authDeletionOutbox: {
    create: MockFn;
    findUnique: MockFn;
    findFirst: MockFn;
    update: MockFn;
    updateMany: MockFn;
  };
  $transaction: MockFn;
  $connect: MockFn;
  $disconnect: MockFn;
};

function createTransactionClient() {
  return {
    finAccount: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where?: { id?: string } }) =>
          Promise.resolve({
            id: args?.where?.id ?? 'acc-1',
            userId: 'user-123',
            currency: 'DOP',
            type: 'CHECKING',
            balance: 1000,
          }),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    finCard: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    finCardBalance: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    finBudget: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    finTransaction: {
      create: jest.fn().mockResolvedValue({
        id: 'tx-1',
        userId: 'user-123',
        accountId: 'acc-1',
        cardId: null,
        type: 'DEBIT',
        amount: { toString: () => '50.00' },
        ledgerAmount: { toString: () => '50.00' },
        amountBaseCurrency: { toString: () => '50.00' },
        currency: 'DOP',
        ledgerCurrency: 'DOP',
        exchangeRate: { toString: () => '1' },
        merchant: null,
        description: null,
        transactionDate: new Date(),
        status: 'CONFIRMED',
        source: 'MANUAL',
        categoryId: null,
        notes: null,
        transferGroupId: null,
        linkedTransactionId: null,
        createdAt: new Date(),
        account: { id: 'acc-1', name: 'Main' },
        card: null,
      }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    domainEventOutbox: {
      create: jest.fn().mockResolvedValue({ id: 'out-1' }),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    authDeletionOutbox: {
      create: jest.fn().mockResolvedValue({ id: 'oob-1' }),
      update: jest.fn(),
    },
    user: {
      delete: jest.fn().mockResolvedValue({ id: 'user-123' }),
    },
  };
}

export function createPrismaMock(): PrismaMock {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    module: {
      findUnique: jest.fn(),
    },
    userModule: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({
        id: 'um-finance',
        isEnabled: true,
        config: { emailSync: { enabled: true, autoCategorize: true } },
      }),
      upsert: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn(),
    },
    pushToken: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiMessage: {
      create: jest.fn(),
    },
    finAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finInstitution: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockImplementation(
        (args: { where?: { id?: string; userId?: string } }) =>
          Promise.resolve({
            id: args?.where?.id ?? 'inst-1',
            userId: args?.where?.userId ?? 'user-123',
            name: 'Bank',
            isActive: true,
          }),
      ),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finExchangeRate: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    finCard: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finLoan: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finReceivable: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finCardBalance: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    finCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    finBudget: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    finEmailSource: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finEmailConnection: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    finEmailMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    // Root-level model used by FinanceOutboxDispatcher.processBatch after commit wake.
    domainEventOutbox: {
      create: jest.fn().mockResolvedValue({ id: 'out-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
    authDeletionOutbox: {
      create: jest.fn().mockResolvedValue({ id: 'oob-1' }),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return arg(createTransactionClient());
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
}
