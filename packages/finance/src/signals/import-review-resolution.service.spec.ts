import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImportReviewResolutionService } from './import-review-resolution.service';

const reviewImport = {
  id: 'import-1',
  userId: 'user-1',
  signalId: 'signal-1',
  sourceEmailMessageId: 'message-1',
  status: 'REVIEW_REQUIRED',
  reviewReason: 'TRANSACTION_DATE_SUGGESTED',
  candidate: {
    transaction: {
      kind: 'TRANSACTION',
      amount: 250.75,
      currency: 'DOP',
      transactionDate: '2026-11-01T18:30:00.000Z',
      direction: 'DEBIT',
      movementClass: 'PURCHASE',
    },
  },
  createdAt: new Date('2026-11-02T10:00:00.000Z'),
  updatedAt: new Date('2026-11-02T10:00:00.000Z'),
};

const settledImport = {
  status: 'IMPORTED',
  transactionId: 'transaction-1',
  reviewReason: null,
};

type JsonRow = Record<string, unknown>;

function setup({
  reviewRow = reviewImport,
  settledRow = settledImport,
  consumeResult = {
    outcome: 'APPLIED',
    domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
  },
  account = { id: 'account-bhd', type: 'SAVINGS' },
  card = { id: 'card-visa' },
  original = { id: 'purchase-1' },
  dismissedCount = 1,
}: {
  reviewRow?: JsonRow | null;
  settledRow?: JsonRow | null;
  consumeResult?: JsonRow;
  account?: JsonRow | null;
  card?: JsonRow | null;
  original?: JsonRow | null;
  dismissedCount?: number;
} = {}) {
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce(reviewRow)
    .mockResolvedValueOnce(settledRow);
  const executeRaw = jest.fn().mockResolvedValue(undefined);
  const transactionOptions = jest.fn();
  const prisma = {
    finSignalImport: {
      findFirst,
      findMany: jest.fn().mockResolvedValue([reviewImport]),
      updateMany: jest.fn().mockResolvedValue({ count: dismissedCount }),
    },
    finSignalImportResolution: {
      create: jest.fn().mockResolvedValue({ id: 'resolution-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    finAccount: { findFirst: jest.fn().mockResolvedValue(account) },
    finCard: { findFirst: jest.fn().mockResolvedValue(card) },
    finTransaction: { findFirst: jest.fn().mockResolvedValue(original) },
    $transaction: jest.fn(
      (handler: (tx: never) => unknown, options?: unknown) => {
        transactionOptions(options);
        const tx = {
          $executeRaw: executeRaw,
          finSignalImport: prisma.finSignalImport,
          finSignalImportResolution: prisma.finSignalImportResolution,
          finAccount: prisma.finAccount,
          finCard: prisma.finCard,
          finTransaction: prisma.finTransaction,
        };
        return handler(tx as never);
      },
    ),
  };
  const signals = {
    consumeResolved: jest.fn().mockResolvedValue(consumeResult),
  };
  const service = new ImportReviewResolutionService(
    prisma as never,
    signals as never,
  );
  return { service, prisma, signals, executeRaw, transactionOptions };
}

describe('ImportReviewResolutionService', () => {
  it('rechaza un import que no existe', async () => {
    const { service } = setup({ reviewRow: null });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'missing',
        input: { action: 'SET_DATE', transactionDate: '2026-11-01T00:00:00Z' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza un import que ya salió de revisión', async () => {
    const { service } = setup({
      reviewRow: { ...reviewImport, status: 'IMPORTED' },
    });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DATE', transactionDate: '2026-11-01T00:00:00Z' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fija la fecha y audita el cambio', async () => {
    const { service, signals, prisma } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DATE', transactionDate: '2026-10-30T12:00:00Z' },
      }),
    ).resolves.toEqual({
      id: 'import-1',
      status: 'IMPORTED',
      outcome: 'IMPORTED',
      transactionId: 'transaction-1',
      reviewReason: null,
    });

    expect(signals.consumeResolved).toHaveBeenCalledWith({
      signal: expect.objectContaining({
        signalId: 'signal-1',
        signalType: 'FINANCE.TRANSACTION_DETECTED',
        sourceId: 'message-1',
      }),
      override: { transactionDate: new Date('2026-10-30T12:00:00Z') },
    });
    expect(prisma.finSignalImportResolution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          signalImportId: 'import-1',
          actorUserId: 'user-1',
          action: 'SET_DATE',
          outcome: 'PENDING',
          changes: { transactionDate: '2026-10-30T12:00:00.000Z' },
        }),
      }),
    );
    expect(prisma.finSignalImportResolution.updateMany).toHaveBeenCalledWith({
      where: { id: 'resolution-1', userId: 'user-1' },
      data: { outcome: 'IMPORTED', reason: null },
    });
  });

  it('exige la fecha en SET_DATE', async () => {
    const { service } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DATE' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige al menos una dirección en SET_DESTINATION', async () => {
    const { service } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DESTINATION' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta la cuenta de origen y la tarjeta en la misma decisión', async () => {
    const { service, signals } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: {
          action: 'SET_DESTINATION',
          accountId: 'account-bhd',
          cardId: 'card-visa',
        },
      }),
    ).resolves.toMatchObject({ status: 'IMPORTED' });

    expect(signals.consumeResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        override: {
          destination: { accountId: 'account-bhd', cardId: 'card-visa' },
        },
      }),
    );
  });

  it('aplica juntas la fecha y el destino', async () => {
    const { service, signals } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: {
          action: 'SET_DATE',
          transactionDate: '2026-10-30T12:00:00Z',
          accountId: 'account-bhd',
        },
      }),
    ).resolves.toMatchObject({ status: 'IMPORTED' });

    expect(signals.consumeResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        override: {
          transactionDate: new Date('2026-10-30T12:00:00Z'),
          destination: { accountId: 'account-bhd' },
        },
      }),
    );
  });

  it('da a la transacción margen para la escritura del consumidor', async () => {
    const { service, transactionOptions } = setup();

    await service.resolve({
      userId: 'user-1',
      importId: 'import-1',
      input: { action: 'SET_DATE', transactionDate: '2026-10-30T12:00:00Z' },
    });

    expect(transactionOptions).toHaveBeenCalledWith({
      timeout: 30_000,
      maxWait: 10_000,
    });
  });

  it('toma el bloqueo por usuario antes de leer el import', async () => {
    const { service, executeRaw } = setup();

    await service.resolve({
      userId: 'user-1',
      importId: 'import-1',
      input: { action: 'SET_DATE', transactionDate: '2026-10-30T12:00:00Z' },
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rechaza una cuenta que no es del usuario', async () => {
    const { service, signals } = setup({ account: null });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DESTINATION', accountId: 'account-other' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(signals.consumeResolved).not.toHaveBeenCalled();
  });

  it('rechaza una cuenta de efectivo como destino', async () => {
    const { service } = setup({ account: { id: 'cash-1', type: 'CASH' } });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DESTINATION', accountId: 'cash-1' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una tarjeta que no existe', async () => {
    const { service } = setup({ card: null });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DESTINATION', cardId: 'card-missing' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('elige la cuenta como destino y audita', async () => {
    const { service, signals, prisma } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'SET_DESTINATION', accountId: 'account-bhd' },
      }),
    ).resolves.toMatchObject({ status: 'IMPORTED' });

    expect(signals.consumeResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        override: { destination: { accountId: 'account-bhd' } },
      }),
    );
    expect(prisma.finSignalImportResolution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SET_DESTINATION',
          outcome: 'PENDING',
          changes: { accountId: 'account-bhd' },
        }),
      }),
    );
    expect(prisma.finSignalImportResolution.updateMany).toHaveBeenCalledWith({
      where: { id: 'resolution-1', userId: 'user-1' },
      data: { outcome: 'IMPORTED', reason: null },
    });
  });

  it('enlaza el reverso con el original elegido', async () => {
    const { service, signals } = setup({
      consumeResult: {
        outcome: 'APPLIED',
        domainReferences: [{ type: 'FinTransaction', id: 'purchase-1' }],
      },
      settledRow: {
        status: 'REVERSED',
        transactionId: 'purchase-1',
        reviewReason: null,
      },
    });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: {
          action: 'LINK_REVERSAL',
          originalTransactionId: 'purchase-1',
        },
      }),
    ).resolves.toMatchObject({ status: 'REVERSED', outcome: 'REVERSED' });

    expect(signals.consumeResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        override: { originalTransactionId: 'purchase-1' },
      }),
    );
  });

  it('exige el original en LINK_REVERSAL y lo busca en el usuario', async () => {
    const { service } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'LINK_REVERSAL' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const { service: missingOriginal } = setup({ original: null });
    await expect(
      missingOriginal.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: {
          action: 'LINK_REVERSAL',
          originalTransactionId: 'purchase-other',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('avisa cuando el import sigue en revisión y deja la auditoría', async () => {
    const { service, prisma } = setup({
      consumeResult: {
        outcome: 'REVIEW_REQUIRED',
        domainReferences: [],
        reason: 'REVERSAL_CURRENCY_MISMATCH',
      },
      settledRow: {
        status: 'REVIEW_REQUIRED',
        transactionId: null,
        reviewReason: 'REVERSAL_CURRENCY_MISMATCH',
      },
    });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: {
          action: 'LINK_REVERSAL',
          originalTransactionId: 'purchase-1',
        },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(prisma.finSignalImportResolution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'LINK_REVERSAL',
          outcome: 'PENDING',
        }),
      }),
    );
    expect(prisma.finSignalImportResolution.updateMany).toHaveBeenCalledWith({
      where: { id: 'resolution-1', userId: 'user-1' },
      data: {
        outcome: 'REVIEW_REQUIRED',
        reason: 'REVERSAL_CURRENCY_MISMATCH',
      },
    });
  });

  it('descarta con motivo y deja el import en un estado terminal', async () => {
    const { service, prisma, signals } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'DISCARD', reason: 'No fue un movimiento real' },
      }),
    ).resolves.toEqual({
      id: 'import-1',
      status: 'DISMISSED',
      outcome: 'DISMISSED',
      transactionId: null,
      reviewReason: null,
    });

    expect(signals.consumeResolved).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'import-1',
        userId: 'user-1',
        status: 'REVIEW_REQUIRED',
      },
      data: { status: 'DISMISSED' },
    });
    expect(prisma.finSignalImportResolution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DISCARD',
        outcome: 'DISMISSED',
        reason: 'No fue un movimiento real',
        changes: { reason: 'No fue un movimiento real' },
      }),
    });
  });

  it('exige un motivo para descartar', async () => {
    const { service, prisma } = setup();

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'DISCARD', reason: '   ' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.finSignalImport.updateMany).not.toHaveBeenCalled();
  });

  it('no descarta si el import cambió de estado mientras se resolvía', async () => {
    const { service } = setup({ dismissedCount: 0 });

    await expect(
      service.resolve({
        userId: 'user-1',
        importId: 'import-1',
        input: { action: 'DISCARD', reason: 'Duplicado' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lista solo los imports en revisión del usuario', async () => {
    const { service, prisma } = setup();

    await expect(service.listForUser('user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'import-1',
        signalId: 'signal-1',
        reviewReason: 'TRANSACTION_DATE_SUGGESTED',
        createdAt: '2026-11-02T10:00:00.000Z',
      }),
    ]);
    expect(prisma.finSignalImport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: 'REVIEW_REQUIRED' },
      }),
    );
  });
});
