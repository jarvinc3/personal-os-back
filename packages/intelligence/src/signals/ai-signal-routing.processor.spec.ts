import { AiSignalRoutingProcessor } from './ai-signal-routing.processor';

describe('AiSignalRoutingProcessor', () => {
  it('delivers a routed signal using stored user and source fields', async () => {
    const row = {
      id: 'signal-1',
      userId: 'user-1',
      type: 'FINANCE.TRANSACTION_DETECTED',
      domain: 'FINANCE',
      sourceType: 'EMAIL_MESSAGE',
      sourceId: 'email-1',
      payload: { transaction: { amount: 12 } },
      occurredAt: new Date('2026-11-02T10:00:00.000Z'),
      status: 'ROUTED',
    };
    const prisma = {
      aiSignal: { findFirst: jest.fn().mockResolvedValue(row) },
    };
    const consume = jest.fn().mockResolvedValue({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'tx-1' }],
    });
    const registry = {
      get: jest.fn().mockReturnValue({ domain: 'FINANCE', consume }),
    };
    const signals = { recordConsumerOutcome: jest.fn() };
    const processor = new AiSignalRoutingProcessor(
      prisma as never,
      registry as never,
      signals as never,
    );

    await processor.process({
      data: { signalId: 'signal-1', userId: 'user-1' },
    } as never);

    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        signalId: 'signal-1',
        userId: 'user-1',
        sourceType: 'EMAIL_MESSAGE',
        sourceId: 'email-1',
      }),
    );
    expect(signals.recordConsumerOutcome).toHaveBeenCalledWith(
      'user-1',
      'signal-1',
      expect.objectContaining({ outcome: 'APPLIED' }),
    );
  });

  it('does not reprocess a signal outside ROUTED state', async () => {
    const prisma = {
      aiSignal: {
        findFirst: jest.fn().mockResolvedValue({ status: 'CONSUMED' }),
      },
    };
    const registry = { get: jest.fn() };
    const signals = { recordConsumerOutcome: jest.fn() };
    const processor = new AiSignalRoutingProcessor(
      prisma as never,
      registry as never,
      signals as never,
    );
    await processor.process({
      data: { signalId: 'signal-1', userId: 'user-1' },
    } as never);
    expect(registry.get).not.toHaveBeenCalled();
    expect(signals.recordConsumerOutcome).not.toHaveBeenCalled();
  });
});
