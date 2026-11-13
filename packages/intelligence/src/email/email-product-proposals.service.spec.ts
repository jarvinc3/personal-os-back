import type {
  EmailProductProposalDraft,
  EmailProductProposalCatalogPort,
} from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import { AiSignalConsumerRegistry } from '../signals/ai-signal-consumer.registry';
import { AiSignalsService } from '../signals/ai-signals.service';
import { EmailProductProposalCatalogRegistry } from './email-product-proposal-catalog.registry';
import { EmailProductProposalsService } from './email-product-proposals.service';

function draft(): EmailProductProposalDraft {
  return {
    productType: 'ACCOUNT',
    name: 'Cuenta BHD ****0016',
    lastFour: '0016',
    currency: 'DOP',
    accountType: null,
    cardType: null,
    network: null,
    accountId: null,
    institution: {
      name: 'BHD',
      type: 'bank',
      domain: 'bhd.com.do',
      country: 'DO',
    },
    accountNumberCiphertext: null,
    accountNumberHash: null,
  };
}

function storedSignal(id: string, lastFour = '0016') {
  return {
    id: `signal-${id}`,
    userId: 'user-1',
    type: 'FINANCE.TRANSACTION_DETECTED',
    domain: 'FINANCE',
    sourceType: 'EMAIL_MESSAGE',
    sourceId: id,
    payload: {
      transaction: { movementClass: 'TRANSFER_OUT' },
    },
    occurredAt: new Date('2026-11-06T15:12:00.000Z'),
    detectedAt: new Date('2026-11-06T15:13:00.000Z'),
    emailMessage: {
      id,
      fromDomain: 'bhd.com.do',
      subject: 'Transacciones entre mis productos',
      receivedAt: new Date('2026-11-06T15:12:58.000Z'),
      content: {
        sanitizedBody: `Producto origen: XXXXXXX${lastFour} Producto destino: XXXXXXX0024 Beneficiario: CTA DE AHORRO MÓVIL`,
      },
    },
  };
}

function createService(overrides?: {
  signals?: unknown[];
  proposal?: Record<string, unknown>;
  catalog?: Partial<EmailProductProposalCatalogPort>;
}) {
  const proposals = new Map<string, Record<string, any>>();
  const evidence = new Map<string, Record<string, any>>();
  const messages = new Map<string, any>();
  const proposal = overrides?.proposal;
  if (proposal) {
    proposals.set(String(proposal.id), { ...proposal });
  }

  const prisma = {
    aiSignal: {
      findMany: jest.fn().mockResolvedValue(overrides?.signals ?? []),
    },
    aiEmailProductProposal: {
      upsert: jest.fn(({ where, create }: any) => {
        const key = `${where.userId_deduplicationKey.userId}:${where.userId_deduplicationKey.deduplicationKey}`;
        const previous = [...proposals.values()].find(
          (item) => item.key === key,
        );
        if (previous) {
          return { id: previous.id };
        }
        const value = {
          id: `proposal-${proposals.size + 1}`,
          key,
          status: 'PENDING',
          approvedProductId: null,
          createdAt: new Date('2026-11-06T16:00:00.000Z'),
          ...create,
        };
        proposals.set(value.id, value);
        return { id: value.id };
      }),
      findUnique: jest.fn(({ where }: any) => {
        const key = `${where.userId_deduplicationKey.userId}:${where.userId_deduplicationKey.deduplicationKey}`;
        const value = [...proposals.values()].find((item) => item.key === key);
        return value ? { id: value.id } : null;
      }),
      findMany: jest.fn(({ where }: any) =>
        [...proposals.values()]
          .filter(
            (item) =>
              item.userId === where.userId &&
              (!where.status || item.status === where.status),
          )
          .map((item) => ({ ...item, evidence: evidenceFor(item.id) })),
      ),
      findFirst: jest.fn(({ where }: any) => {
        const value = proposals.get(where.id);
        return value?.userId === where.userId
          ? { ...value, evidence: evidenceFor(value.id) }
          : null;
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        const value = proposals.get(where.id);
        if (
          !value ||
          value.userId !== where.userId ||
          (where.status && value.status !== where.status)
        ) {
          return { count: 0 };
        }
        Object.assign(value, data);
        return { count: 1 };
      }),
    },
    aiEmailProductProposalEvidence: {
      createMany: jest.fn(({ data }: any) => {
        let count = 0;
        for (const item of data) {
          const key = `${item.proposalId}:${item.messageId}`;
          if (!evidence.has(key)) {
            evidence.set(key, item);
            count += 1;
          }
        }
        return { count };
      }),
      findMany: jest.fn(({ where }: any) =>
        [...evidence.values()].filter(
          (item) =>
            item.userId === where.userId &&
            item.proposalId === where.proposalId,
        ),
      ),
    },
  };

  function evidenceFor(proposalId: string) {
    return [...evidence.values()]
      .filter((item) => item.proposalId === proposalId)
      .map((item) => ({
        ...item,
        createdAt: new Date('2026-11-06T16:01:00.000Z'),
        message: messages.get(item.messageId) ?? {
          id: item.messageId,
          fromDomain: 'bhd.com.do',
          subject: 'Transacciones entre mis productos',
          receivedAt: new Date('2026-11-06T15:12:58.000Z'),
        },
      }));
  }

  const originalUpsert = prisma.aiEmailProductProposal.upsert;
  prisma.aiEmailProductProposal.upsert = jest.fn((args: any) => {
    const result = originalUpsert(args);
    const row = proposals.get(result.id)!;
    row.userId = args.create.userId;
    return result;
  });

  for (const signal of overrides?.signals ?? []) {
    const message = (signal as any).emailMessage;
    if (message) {
      messages.set(message.id, message);
    }
  }

  const financeConsumer = {
    preview: jest.fn().mockResolvedValue({
      outcome: 'REVIEW_REQUIRED',
      reviewReasons: ['NO_LEDGER_TARGET'],
    }),
    consume: jest.fn().mockResolvedValue({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'account', id: 'account-1' }],
    }),
  };
  const consumers = { get: jest.fn(() => financeConsumer) };
  const signals = {
    recordConsumerOutcome: jest.fn().mockResolvedValue(undefined),
  };
  const catalog: Partial<EmailProductProposalCatalogPort> = {
    prepareAccountNumber: jest.fn().mockResolvedValue({
      ciphertext: 'encrypted-account-number',
      hash: 'blind-index',
      lastFour: '0016',
    }),
    findExisting: jest.fn().mockResolvedValue(null),
    createOrReuse: jest.fn().mockResolvedValue({
      productId: 'account-1',
      duplicate: false,
    }),
    ...overrides?.catalog,
  };
  const catalogRegistry = { get: jest.fn(() => catalog) };
  const service = new EmailProductProposalsService(
    prisma as unknown as PrismaService,
    consumers as unknown as AiSignalConsumerRegistry,
    signals as unknown as AiSignalsService,
    catalogRegistry as unknown as EmailProductProposalCatalogRegistry,
  );
  return {
    service,
    prisma,
    proposals,
    evidence,
    catalog,
    financeConsumer,
    signals,
  };
}

describe('EmailProductProposalsService', () => {
  it('deduplicates repeated product detections and preserves separate evidence', async () => {
    const rows = [storedSignal('message-1'), storedSignal('message-2')];
    const { service, proposals, evidence } = createService({ signals: rows });

    const result = await service.discover({ userId: 'user-1', limit: 20 });

    expect(result.created).toBe(1);
    expect(result.evidenceAdded).toBe(2);
    expect(proposals.size).toBe(1);
    expect(evidence.size).toBe(2);
  });

  it('keeps the edited suffix and encrypts an optional full number before approval', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service, proposals, catalog, financeConsumer, signals } =
      createService({
        proposal: row,
        signals: [
          {
            ...storedSignal('message-1'),
            emailMessage: undefined,
          },
        ],
      });
    const prisma = (service as any).prisma;
    await prisma.aiEmailProductProposalEvidence.createMany({
      data: [
        {
          userId: 'user-1',
          proposalId: 'proposal-1',
          messageId: 'message-1',
          evidence: {
            label: 'Producto origen',
            lastFour: '0016',
            side: 'SOURCE',
          },
        },
      ],
    });

    await service.update('user-1', 'proposal-1', {
      name: 'Ahorros BHD',
      accountType: 'SAVINGS',
      accountNumber: '0000000016',
    });
    const result = await service.approve('user-1', 'proposal-1');
    const secondApproval = await service.approve('user-1', 'proposal-1');

    expect(catalog.prepareAccountNumber).toHaveBeenCalledWith({
      accountNumber: '0000000016',
    });
    expect(catalog.createOrReuse).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        name: 'Ahorros BHD',
        accountType: 'SAVINGS',
        lastFour: '0016',
        accountNumberCiphertext: 'encrypted-account-number',
        accountNumberHash: 'blind-index',
      }),
    );
    expect(result.draft).not.toHaveProperty('accountNumberCiphertext');
    expect(result.draft).not.toHaveProperty('accountNumberHash');
    expect(result.draft.accountNumberProvided).toBe(true);
    expect(result.status).toBe('APPROVED');
    expect(secondApproval.status).toBe('APPROVED');
    expect(catalog.createOrReuse).toHaveBeenCalledTimes(1);
    expect(financeConsumer.consume).toHaveBeenCalledTimes(1);
    expect(signals.recordConsumerOutcome).toHaveBeenCalledTimes(1);
    expect(proposals.get('proposal-1')?.approvedProductId).toBe('account-1');
  });

  it('does not create a proposal when Finance already has the matching product', async () => {
    const { service, proposals } = createService({
      signals: [storedSignal('message-1')],
      catalog: {
        findExisting: jest.fn().mockResolvedValue({
          productId: 'existing-account',
          ambiguous: false,
        }),
      },
    });

    const result = await service.discover({ userId: 'user-1' });

    expect(result.created).toBe(0);
    expect(proposals.size).toBe(0);
  });
});
