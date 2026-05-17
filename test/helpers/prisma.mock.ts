type MockFn = jest.Mock<any, any>;

export type PrismaMock = {
  user: {
    findUnique: MockFn;
    update: MockFn;
  };
  notification: {
    create: MockFn;
    update: MockFn;
  };
  pushToken: {
    upsert: MockFn;
    updateMany: MockFn;
    findMany: MockFn;
  };
  aiMessage: {
    create: MockFn;
  };
  $connect: MockFn;
  $disconnect: MockFn;
};

export function createPrismaMock(): PrismaMock {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      update: jest.fn(),
    },
    pushToken: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiMessage: {
      create: jest.fn(),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
}
