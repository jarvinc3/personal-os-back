import type { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';
import { BackfillPendingEmailUseCase } from './backfill-pending-email.use-case';
import type { RouteExtractedEmailUseCase } from './route-extracted-email.use-case';

describe('BackfillPendingEmailUseCase', () => {
  const extractedPayload = {
    amount: 850,
    currency: 'DOP',
    type: 'DEBIT' as const,
    transactionDate: '2026-08-01T14:00:00.000Z',
    description: 'Compra en comercio',
    merchant: 'Comercio',
  };

  function pendingMessage(gmailMessageId: string) {
    return {
      sourceId: 'src-1',
      source: { institutionId: 'inst-1' },
      gmailMessageId,
      outcome: EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT,
      provider: 'groq',
      model: 'test-model',
      extractedPayload,
    };
  }

  function buildUseCase(
    pendingMessages: unknown[],
    routeExecute: jest.Mock,
  ): BackfillPendingEmailUseCase {
    const emailSources = {
      listPendingAssignmentMessages: jest
        .fn()
        .mockResolvedValue(pendingMessages),
      listInstitutionDestinations: jest.fn().mockResolvedValue([[], []]),
    } as unknown as EmailSourceRepository;
    const routeExtracted = {
      execute: routeExecute,
    } as unknown as RouteExtractedEmailUseCase;
    return new BackfillPendingEmailUseCase(
      emailSources,
      routeExtracted,
      {} as unknown as ImportEmailTransactionUseCase,
    );
  }

  it('keeps the batch going when one message fails to route', async () => {
    const routeExecute = jest
      .fn()
      .mockRejectedValueOnce(new Error('Exchange rate unavailable'))
      .mockResolvedValueOnce({ kind: 'imported' });
    const useCase = buildUseCase(
      [pendingMessage('gmail-1'), pendingMessage('gmail-2')],
      routeExecute,
    );

    await expect(useCase.execute('user-1')).resolves.toEqual({ imported: 1 });
    expect(routeExecute).toHaveBeenCalledTimes(2);
  });
});
