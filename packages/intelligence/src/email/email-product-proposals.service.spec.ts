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

function linkableProduct(overrides: Record<string, unknown> = {}) {
  return {
    productId: 'account-1',
    productType: 'ACCOUNT',
    lastFour: '0016',
    isActive: true,
    institutionId: 'institution-bhd',
    institutionIsSystem: false,
    ...overrides,
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
    findProductForLink: jest.fn().mockResolvedValue(null),
    listInstitutions: jest.fn().mockResolvedValue([]),
    findProductMatches: jest.fn().mockResolvedValue([]),
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
    prisma.aiEmailProductProposalEvidence.createMany({
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
    financeConsumer.preview.mockResolvedValue({ outcome: 'APPLIED' });
    const result = await service.approve({
      userId: 'user-1',
      proposalId: 'proposal-1',
    });
    const secondApproval = await service.approve({
      userId: 'user-1',
      proposalId: 'proposal-1',
    });

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

  it('consumes and records the remaining review after the product blocker is resolved', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service, prisma, financeConsumer, signals } = createService({
      proposal: row,
      signals: [storedSignal('message-1')],
    });
    prisma.aiEmailProductProposalEvidence.createMany({
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
    financeConsumer.preview.mockResolvedValue({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_DIRECTION_AMBIGUOUS',
      reviewReasons: ['TRANSFER_DIRECTION_AMBIGUOUS'],
    });
    financeConsumer.consume.mockResolvedValue({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_DIRECTION_AMBIGUOUS',
      domainReferences: [],
    });

    const result = await service.approve({
      userId: 'user-1',
      proposalId: 'proposal-1',
    });

    expect(financeConsumer.consume).toHaveBeenCalledTimes(1);
    expect(signals.recordConsumerOutcome).toHaveBeenCalledWith(
      'user-1',
      'signal-message-1',
      expect.objectContaining({
        outcome: 'REVIEW_REQUIRED',
        reason: 'TRANSFER_DIRECTION_AMBIGUOUS',
      }),
    );
    expect(result.approval.reevaluatedSignals).toBe(1);
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
    expect(result.alreadyExists).toBe(1);
    expect(proposals.size).toBe(0);
  });

  it('reports ambiguous compatible products without creating a proposal', async () => {
    const { service, proposals } = createService({
      signals: [storedSignal('message-1')],
      catalog: {
        findExisting: jest.fn().mockResolvedValue({
          productId: 'existing-account',
          ambiguous: true,
        }),
      },
    });

    const result = await service.discover({ userId: 'user-1' });

    expect(result.created).toBe(0);
    expect(result.ambiguous).toBe(1);
    expect(result.alreadyExists).toBe(0);
    expect(proposals.size).toBe(0);
  });

  it('keeps collecting evidence in a pending proposal when the product appears later', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service, proposals, evidence } = createService({
      signals: [storedSignal('message-1')],
      proposal: { ...row, key: 'user-1:bhd.com.do:ACCOUNT:0016' },
      catalog: {
        findExisting: jest.fn().mockResolvedValue({
          productId: 'existing-account',
          ambiguous: false,
        }),
      },
    });

    const result = await service.discover({ userId: 'user-1' });

    expect(result.created).toBe(0);
    expect(result.alreadyExists).toBe(0);
    expect(proposals.size).toBe(1);
    expect(evidence.size).toBe(1);
  });

  it('marks the compatible institution and the active product of a pending proposal', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({
      proposal: row,
      catalog: {
        listInstitutions: jest.fn().mockResolvedValue([
          { id: 'institution-bhd', name: 'BHD', domain: 'bhd.com.do' },
          {
            id: 'institution-other',
            name: 'Banreservas',
            domain: 'banreservas.com',
          },
        ]),
        findProductMatches: jest.fn().mockResolvedValue([['account-existing']]),
      },
    });

    const [proposal] = await service.list('user-1', 'PENDING');

    expect(proposal.draft.institution.matchedInstitutionId).toBe(
      'institution-bhd',
    );
    expect(proposal.draft.institution.matchedInstitutionIds).toEqual([
      'institution-bhd',
    ]);
    expect(proposal.matchedProductId).toBe('account-existing');
    expect(proposal.matchedProductIds).toEqual(['account-existing']);
  });

  it('does not pick one product when several are compatible', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({
      proposal: row,
      catalog: {
        findProductMatches: jest
          .fn()
          .mockResolvedValue([['account-a', 'account-b']]),
      },
    });

    const [proposal] = await service.list('user-1', 'PENDING');

    expect(proposal.matchedProductId).toBeNull();
    expect(proposal.matchedProductIds).toEqual(['account-a', 'account-b']);
  });

  it('reports several compatible institutions as ambiguous', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({
      proposal: row,
      catalog: {
        listInstitutions: jest.fn().mockResolvedValue([
          { id: 'institution-a', name: 'BHD', domain: 'bhd.com.do' },
          { id: 'institution-b', name: 'Banco BHD', domain: 'BHD.com.do' },
        ]),
      },
    });

    const [proposal] = await service.list('user-1', 'PENDING');

    expect(proposal.draft.institution.matchedInstitutionId).toBeNull();
    expect(proposal.draft.institution.matchedInstitutionIds).toEqual([
      'institution-a',
      'institution-b',
    ]);
  });

  it('links an existing product, keeps the evidence and reevaluates the signals', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service, prisma, proposals, catalog, financeConsumer, signals } =
      createService({
        proposal: row,
        signals: [storedSignal('message-1')],
        catalog: {
          findProductForLink: jest.fn().mockResolvedValue(linkableProduct()),
        },
      });
    prisma.aiEmailProductProposalEvidence.createMany({
      data: [
        {
          userId: 'user-1',
          proposalId: 'proposal-1',
          messageId: 'message-1',
          evidence: {},
        },
      ],
    });
    financeConsumer.preview.mockResolvedValue({ outcome: 'APPLIED' });

    const approval = await service.approve({
      userId: 'user-1',
      proposalId: 'proposal-1',
      productId: 'account-1',
    });

    expect(catalog.createOrReuse).not.toHaveBeenCalled();
    expect(catalog.prepareAccountNumber).not.toHaveBeenCalled();
    expect(proposals.get('proposal-1')?.approvedProductId).toBe('account-1');
    expect(approval.status).toBe('APPROVED');
    expect(approval.approval).toEqual({
      duplicate: false,
      productId: 'account-1',
      reevaluatedSignals: 1,
    });
    expect(financeConsumer.consume).toHaveBeenCalledTimes(1);
    expect(signals.recordConsumerOutcome).toHaveBeenCalledTimes(1);
  });

  it('records the last four of the product created with the native form', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service, proposals } = createService({
      proposal: row,
      catalog: {
        findProductForLink: jest
          .fn()
          .mockResolvedValue(linkableProduct({ lastFour: '9999' })),
      },
    });

    const approvedProposal = await service.approve({
      userId: 'user-1',
      proposalId: 'proposal-1',
      productId: 'account-1',
    });

    expect(approvedProposal.draft.lastFour).toBe('9999');
    expect(proposals.get('proposal-1')?.draft.lastFour).toBe('9999');
  });

  it('approves again with the same product without reevaluating twice', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'APPROVED',
      draft: draft(),
      approvedProductId: 'account-1',
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service, catalog, financeConsumer } = createService({
      proposal: row,
      signals: [storedSignal('message-1')],
    });

    const repeatedApproval = await service.approve({
      userId: 'user-1',
      proposalId: 'proposal-1',
      productId: 'account-1',
    });

    expect(repeatedApproval.status).toBe('APPROVED');
    expect(repeatedApproval).not.toHaveProperty('approval');
    expect(catalog.findProductForLink).not.toHaveBeenCalled();
    expect(financeConsumer.consume).not.toHaveBeenCalled();
  });

  it('rejects a proposal already approved with another product', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'APPROVED',
      draft: draft(),
      approvedProductId: 'account-1',
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({ proposal: row });

    await expect(
      service.approve({
        userId: 'user-1',
        proposalId: 'proposal-1',
        productId: 'account-2',
      }),
    ).rejects.toThrow('La propuesta ya está aprobada con otro producto');
  });

  it('rejects a discarded proposal', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'DISCARDED',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service, catalog } = createService({ proposal: row });

    await expect(
      service.approve({
        userId: 'user-1',
        proposalId: 'proposal-1',
        productId: 'account-1',
      }),
    ).rejects.toThrow('La propuesta no está pendiente de aprobación');
    expect(catalog.findProductForLink).not.toHaveBeenCalled();
  });

  it('rejects a product that does not exist for the user', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({ proposal: row });

    await expect(
      service.approve({
        userId: 'user-1',
        proposalId: 'proposal-1',
        productId: 'missing',
      }),
    ).rejects.toThrow('Producto no encontrado');
  });

  it('rejects an archived product', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({
      proposal: row,
      catalog: {
        findProductForLink: jest
          .fn()
          .mockResolvedValue(linkableProduct({ isActive: false })),
      },
    });

    await expect(
      service.approve({
        userId: 'user-1',
        proposalId: 'proposal-1',
        productId: 'account-1',
      }),
    ).rejects.toThrow('El producto está archivado; desarchívalo o elige otro');
  });

  it('rejects a product of another type', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({
      proposal: row,
      catalog: {
        findProductForLink: jest
          .fn()
          .mockResolvedValue(linkableProduct({ productType: 'CARD' })),
      },
    });

    await expect(
      service.approve({
        userId: 'user-1',
        proposalId: 'proposal-1',
        productId: 'account-1',
      }),
    ).rejects.toThrow('La propuesta es de cuenta y el producto es de tarjeta');
  });

  it('rejects a product without last four digits', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({
      proposal: row,
      catalog: {
        findProductForLink: jest
          .fn()
          .mockResolvedValue(linkableProduct({ lastFour: null })),
      },
    });

    await expect(
      service.approve({
        userId: 'user-1',
        proposalId: 'proposal-1',
        productId: 'account-1',
      }),
    ).rejects.toThrow(
      'El producto no tiene últimos 4 dígitos; no se puede verificar la propuesta',
    );
  });

  it('rejects a cash product', async () => {
    const row = {
      id: 'proposal-1',
      userId: 'user-1',
      productType: 'ACCOUNT',
      status: 'PENDING',
      draft: draft(),
      approvedProductId: null,
      createdAt: new Date('2026-11-06T16:00:00.000Z'),
    };
    const { service } = createService({
      proposal: row,
      catalog: {
        findProductForLink: jest
          .fn()
          .mockResolvedValue(linkableProduct({ institutionId: null })),
      },
    });

    await expect(
      service.approve({
        userId: 'user-1',
        proposalId: 'proposal-1',
        productId: 'account-1',
      }),
    ).rejects.toThrow('Vincula un producto de una institución, no de Efectivo');
  });
});
