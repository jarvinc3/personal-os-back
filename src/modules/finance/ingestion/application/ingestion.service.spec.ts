import type { ConfigService } from '@nestjs/config';
import { AppEvents } from '../../../../core/events/event.constants';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { IngestionService } from './ingestion.service';

describe('IngestionService.completeEmailSyncSuccessWithEvent', () => {
  it('enqueues finance.email_sync.completed via same-TX outbox helper', async () => {
    const completeEmailSyncSuccessWithOutbox = jest.fn().mockResolvedValue(undefined);
    const repo = {
      completeEmailSyncSuccessWithOutbox,
    } as unknown as EmailSourceRepository;

    const processBatch = jest.fn();
    const outboxDispatcher = {
      processBatch,
    } as unknown as FinanceOutboxDispatcher;

    const config = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const events = {
      enqueue: jest.fn(),
    } as unknown as DomainEventPublisherPort;

    const service = new IngestionService(
      repo,
      config as never,
      events,
      outboxDispatcher,
      undefined,
    );

    await service.completeEmailSyncSuccessWithEvent({
      logId: 'log-1',
      userId: 'user-1',
      sourceId: 'src-1',
      emailsScanned: 2,
      transactionsNew: 1,
      transactionIds: ['tx-1'],
      countsByStatus: { PENDING: 1 },
    });

    expect(completeEmailSyncSuccessWithOutbox).toHaveBeenCalledWith(
      'log-1',
      {
        status: 'SUCCESS',
        emailsScanned: 2,
        transactionsNew: 1,
      },
      expect.objectContaining({
        eventName: AppEvents.FINANCE_EMAIL_SYNC_COMPLETED,
        aggregateType: 'FinEmailSource',
        aggregateId: 'src-1',
        userId: 'user-1',
        payload: expect.objectContaining({
          sourceId: 'src-1',
          emailsScanned: 2,
          transactionsNew: 1,
          transactionIds: ['tx-1'],
          countsByStatus: { PENDING: 1 },
          version: 1,
        }),
      }),
    );
    expect(processBatch).toHaveBeenCalled();
  });
});
