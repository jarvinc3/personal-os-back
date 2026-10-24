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
    count: MockFn;
  };
  aiMessage: {
    create: MockFn;
  };
  aiAgentSession: {
    findFirst: MockFn;
    findMany: MockFn;
    create: MockFn;
    update: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  idempotencyKey: {
    findUnique: MockFn;
    create: MockFn;
    update: MockFn;
    delete: MockFn;
    deleteMany: MockFn;
  };
  finAccount: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finInstitution: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finExchangeRate: {
    findMany: MockFn;
    findUnique: MockFn;
    upsert: MockFn;
  };
  finTransaction: {
    findMany: MockFn;
    findFirst: MockFn;
    count: MockFn;
    create: MockFn;
    groupBy: MockFn;
    aggregate: MockFn;
    update: MockFn;
    updateMany: MockFn;
  };
  finCard: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finLoan: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finLoanInstallment: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    createMany: MockFn;
    update: MockFn;
    updateMany: MockFn;
    delete: MockFn;
    deleteMany: MockFn;
    upsert: MockFn;
    count: MockFn;
  };
  finReceivable: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finSavingsGoal: {
    findMany: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finCardBalance: {
    findMany: MockFn;
    findFirst: MockFn;
    count: MockFn;
  };
  finCardStatement: {
    findMany: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    create: MockFn;
    createMany: MockFn;
    update: MockFn;
    updateMany: MockFn;
    delete: MockFn;
    deleteMany: MockFn;
    upsert: MockFn;
    count: MockFn;
  };
  finCategory: {
    findMany: MockFn;
    findFirst: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finStatementImport: {
    create: MockFn;
    findFirst: MockFn;
    update: MockFn;
    updateMany: MockFn;
    delete: MockFn;
  };
  finStatementImportLine: {
    createMany: MockFn;
    update: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
  };
  finBudget: {
    findMany: MockFn;
    findFirst: MockFn;
    count: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
  };
  finBudgetCategory: {
    findMany: MockFn;
    createMany: MockFn;
    deleteMany: MockFn;
  };
  finEmailSource: {
    findMany: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    create: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finEmailConnection: {
    findMany: MockFn;
    findUnique: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
    updateMany: MockFn;
    count: MockFn;
  };
  finEmailMessage: {
    findMany: MockFn;
    findFirst: MockFn;
    findUnique: MockFn;
    upsert: MockFn;
  };
  finReceivablePayment: {
    findMany: MockFn;
    deleteMany: MockFn;
  };
  finReceivableShare: {
    findUnique: MockFn;
    findFirst: MockFn;
    findMany: MockFn;
    create: MockFn;
    updateMany: MockFn;
  };
  finReceivableShareItem: {
    createMany: MockFn;
    deleteMany: MockFn;
  };
  finSavingsGoalContribution: {
    findMany: MockFn;
    deleteMany: MockFn;
  };
  finDeletionJournal: {
    create: MockFn;
    findFirst: MockFn;
    findMany: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
  };
  finInstrumentEvent: {
    create: MockFn;
    findMany: MockFn;
  };
  finReconciliation: {
    findMany: MockFn;
    findFirst: MockFn;
    findFirstOrThrow: MockFn;
    create: MockFn;
    delete: MockFn;
    deleteMany: MockFn;
  };
  finMerchant: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
    updateMany: MockFn;
    count: MockFn;
  };
  finRecurringPattern: {
    findMany: MockFn;
    findFirst: MockFn;
    updateMany: MockFn;
    deleteMany: MockFn;
  };
  finMerchantDuplicateDismissal: {
    findMany: MockFn;
    upsert: MockFn;
    createMany: MockFn;
    deleteMany: MockFn;
  };
  finMerchantAlias: {
    findMany: MockFn;
    create: MockFn;
    createMany: MockFn;
    deleteMany: MockFn;
    count: MockFn;
  };
  finReconciliationAdjustment: {
    findMany: MockFn;
    create: MockFn;
    deleteMany: MockFn;
  };
  finBalanceDrift: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
    update: MockFn;
    updateMany: MockFn;
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

function createTransactionClient(prismaMock: PrismaMock) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    // The delete flows read the entity and remove it inside the transaction,
    // so those models share the root mock: a test configures and asserts in
    // one place.
    finAccount: {
      findFirst: prismaMock.finAccount.findFirst,
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: prismaMock.finAccount.deleteMany,
    },
    finCard: {
      findFirst: prismaMock.finCard.findFirst,
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: prismaMock.finCard.deleteMany,
    },
    finInstitution: {
      findFirst: prismaMock.finInstitution.findFirst,
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: prismaMock.finInstitution.deleteMany,
      count: prismaMock.finInstitution.count,
    },
    finLoan: {
      findFirst: prismaMock.finLoan.findFirst,
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: prismaMock.finLoan.deleteMany,
    },
    finReceivable: {
      findFirst: prismaMock.finReceivable.findFirst,
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: prismaMock.finReceivable.deleteMany,
    },
    finEmailSource: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: prismaMock.finEmailSource.deleteMany,
    },
    finCategory: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finReceivablePayment: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finReceivableShare: {
      findUnique: prismaMock.finReceivableShare.findUnique,
      findFirst: prismaMock.finReceivableShare.findFirst,
      findMany: jest.fn().mockResolvedValue([]),
      create: prismaMock.finReceivableShare.create,
      updateMany: prismaMock.finReceivableShare.updateMany,
    },
    finReceivableShareItem: {
      createMany: prismaMock.finReceivableShareItem.createMany,
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finSavingsGoalContribution: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finDeletionJournal: {
      create: prismaMock.finDeletionJournal.create,
      updateMany: prismaMock.finDeletionJournal.updateMany,
    },
    finInstrumentEvent: {
      create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    finReconciliation: {
      findFirst: prismaMock.finReconciliation.findFirst,
      findFirstOrThrow: prismaMock.finReconciliation.findFirstOrThrow,
      create: prismaMock.finReconciliation.create,
      delete: prismaMock.finReconciliation.delete,
      deleteMany: prismaMock.finReconciliation.deleteMany,
    },
    finReconciliationAdjustment: {
      create: prismaMock.finReconciliationAdjustment.create,
      deleteMany: prismaMock.finReconciliationAdjustment.deleteMany,
    },
    finBalanceDrift: {
      findMany: prismaMock.finBalanceDrift.findMany,
      findFirst: prismaMock.finBalanceDrift.findFirst,
      create: prismaMock.finBalanceDrift.create,
      update: prismaMock.finBalanceDrift.update,
      updateMany: prismaMock.finBalanceDrift.updateMany,
    },
    finMerchant: {
      findMany: prismaMock.finMerchant.findMany,
      findFirst: prismaMock.finMerchant.findFirst,
      create: prismaMock.finMerchant.create,
      update: prismaMock.finMerchant.update,
      updateMany: prismaMock.finMerchant.updateMany,
      count: prismaMock.finMerchant.count,
      delete: jest.fn().mockResolvedValue({}),
    },
    finMerchantAlias: {
      findMany: prismaMock.finMerchantAlias.findMany,
      create: prismaMock.finMerchantAlias.create,
      createMany: prismaMock.finMerchantAlias.createMany,
      deleteMany: prismaMock.finMerchantAlias.deleteMany,
      count: prismaMock.finMerchantAlias.count,
    },
    finRecurringPattern: {
      findMany: prismaMock.finRecurringPattern.findMany,
      findFirst: prismaMock.finRecurringPattern.findFirst,
      updateMany: prismaMock.finRecurringPattern.updateMany,
      deleteMany: prismaMock.finRecurringPattern.deleteMany,
    },
    finMerchantDuplicateDismissal: {
      findMany: prismaMock.finMerchantDuplicateDismissal.findMany,
      upsert: prismaMock.finMerchantDuplicateDismissal.upsert,
      createMany: prismaMock.finMerchantDuplicateDismissal.createMany,
      deleteMany: prismaMock.finMerchantDuplicateDismissal.deleteMany,
    },
    finCardBalance: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    finCardStatement: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finStatementImport: {
      create: jest.fn().mockResolvedValue({ id: 'import-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    finStatementImportLine: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finLoanInstallment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finSavingsGoal: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finBudget: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      deleteMany: prismaMock.finBudget.deleteMany,
    },
    finBudgetCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    userModule: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

type IdempotencyRow = {
  id: string;
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  status: string;
  responseStatus: number | null;
  responseBody: string | null;
  createdAt: Date;
  expiresAt: Date;
};

type IdempotencyRowInput = Omit<
  IdempotencyRow,
  'id' | 'createdAt' | 'responseStatus' | 'responseBody'
>;

/** In-memory stand-in for the idempotency_keys table in e2e tests. */
function createIdempotencyKeyMock() {
  const rows = new Map<string, IdempotencyRow>();
  let sequence = 0;
  const rowKey = (userId: string, key: string): string => `${userId}:${key}`;

  return {
    findUnique: jest.fn(
      (args: { where: { userId_key: { userId: string; key: string } } }) =>
        Promise.resolve(
          rows.get(
            rowKey(args.where.userId_key.userId, args.where.userId_key.key),
          ) ?? null,
        ),
    ),
    create: jest.fn(({ data: rowInput }: { data: IdempotencyRowInput }) => {
      const key = rowKey(rowInput.userId, rowInput.key);
      if (rows.has(key)) {
        return Promise.reject(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          }),
        );
      }
      sequence += 1;
      const row: IdempotencyRow = {
        id: `idem-${sequence}`,
        ...rowInput,
        responseStatus: null,
        responseBody: null,
        createdAt: new Date(),
      };
      rows.set(key, row);
      return Promise.resolve(row);
    }),
    update: jest.fn(
      ({
        where,
        data: rowPatch,
      }: {
        where: { userId_key: { userId: string; key: string } };
        data: Partial<IdempotencyRow>;
      }) => {
        const key = rowKey(where.userId_key.userId, where.userId_key.key);
        const existingRow = rows.get(key);
        if (!existingRow) {
          return Promise.reject(
            Object.assign(new Error('Record not found'), { code: 'P2025' }),
          );
        }
        const updatedRow = { ...existingRow, ...rowPatch };
        rows.set(key, updatedRow);
        return Promise.resolve(updatedRow);
      },
    ),
    delete: jest.fn((args: { where: { id: string } }) => {
      for (const [key, row] of rows) {
        if (row.id === args.where.id) {
          rows.delete(key);
          return Promise.resolve(row);
        }
      }
      return Promise.reject(
        Object.assign(new Error('Record not found'), { code: 'P2025' }),
      );
    }),
    deleteMany: jest.fn((args: { where: { userId: string; key: string } }) => {
      const removed = rows.delete(rowKey(args.where.userId, args.where.key));
      return Promise.resolve({ count: removed ? 1 : 0 });
    }),
  };
}

export function createPrismaMock(): PrismaMock {
  const client = {
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
      count: jest.fn().mockResolvedValue(0),
    },
    aiMessage: {
      create: jest.fn(),
    },
    aiAgentSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    aiAgentSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    idempotencyKey: createIdempotencyKeyMock(),
    finAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finInstitution: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest
        .fn()
        .mockImplementation(
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
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finExchangeRate: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    finCard: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finLoan: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finLoanInstallment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    finLoanPrepayment: {
      create: jest.fn().mockResolvedValue({ id: 'prepay-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    finReceivable: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finSavingsGoal: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finCardBalance: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    finCardStatement: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    finStatementImport: {
      create: jest.fn().mockResolvedValue({ id: 'import-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    finStatementImportLine: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finBudget: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finBudgetCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { ledgerAmount: null } }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finEmailSource: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finEmailConnection: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finEmailMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    finReceivablePayment: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finReceivableShare: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finReceivableShareItem: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finSavingsGoalContribution: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finDeletionJournal: {
      create: jest.fn().mockResolvedValue({ id: 'journal-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finInstrumentEvent: {
      create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    finReconciliation: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findFirstOrThrow: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finMerchant: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'merchant-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockResolvedValue({}),
    },
    finMerchantAlias: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'alias-1' }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    finRecurringPattern: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finMerchantDuplicateDismissal: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'dismissal-1' }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finReconciliationAdjustment: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    finBalanceDrift: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    $transaction: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  client.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return arg(createTransactionClient(client));
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  return client;
}
