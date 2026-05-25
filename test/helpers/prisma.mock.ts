type MockFn = jest.Mock<any, any>;

export type PrismaMock = {
  user: {
    findUnique: MockFn;
    update: MockFn;
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
  $transaction: MockFn;
  $connect: MockFn;
  $disconnect: MockFn;
};

export function createPrismaMock(): PrismaMock {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
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
    $transaction: jest.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return arg({
          finAccount: {
            findFirst: jest.fn(),
            update: jest.fn(),
          },
          finTransaction: {
            create: jest.fn(),
          },
        });
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
}
