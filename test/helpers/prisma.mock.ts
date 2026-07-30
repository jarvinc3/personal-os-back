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
  };
  finTransaction: {
    findMany: MockFn;
    findFirst: MockFn;
    count: MockFn;
    create: MockFn;
  };
  finEmailSource: {
    findMany: MockFn;
    findFirst: MockFn;
    updateMany: MockFn;
  };
  $transaction: MockFn;
  $connect: MockFn;
  $disconnect: MockFn;
};

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
    },
    finTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    },
    finEmailSource: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        const tx = {
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              userId: 'user-123',
              currency: 'DOP',
            }),
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
              amountBaseCurrency: { toString: () => '50.00' },
              currency: 'DOP',
              merchant: null,
              description: null,
              transactionDate: new Date(),
              status: 'CONFIRMED',
              source: 'MANUAL',
              categoryId: null,
              notes: null,
              transferGroupId: null,
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
        };
        return arg(tx);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
}
