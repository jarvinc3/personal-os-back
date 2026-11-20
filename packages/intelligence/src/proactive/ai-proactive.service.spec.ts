import { AiProactiveService } from './ai-proactive.service';

const suggestionRow = {
  id: 'suggestion-1',
  signalId: 'signal-1',
  signalType: 'FINANCE.TRANSACTION_DETECTED',
  title: 'Tenés un movimiento por revisar',
  body: 'Quedó esperando una decisión.',
  actionId: null,
  createdAt: new Date('2026-11-19T18:00:00.000Z'),
};

const relevantSignal = {
  type: 'FINANCE.TRANSACTION_DETECTED',
  status: 'ROUTED',
  payload: {
    consumption: { outcome: 'REVIEW_REQUIRED', reason: 'NO_LEDGER_TARGET' },
  },
};

function setup({
  signal = relevantSignal,
  existing = null,
  created = suggestionRow,
  reserved = new Date('2026-11-19T18:00:00.000Z'),
  generated = {
    title: 'Tenés un movimiento por revisar',
    body: 'Quedó esperando una decisión.',
    costUsd: 0.0002,
  },
  generateError,
  capabilities = [],
  proposal,
} = {}) {
  const signals = {
    findSignal: jest.fn().mockResolvedValue(signal),
    findSuggestion: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(created),
    setActionId: jest.fn().mockResolvedValue(undefined),
    listForUser: jest.fn().mockResolvedValue([suggestionRow]),
    findDiscard: jest.fn().mockResolvedValue(null),
    recordDiscard: jest.fn().mockResolvedValue(undefined),
  };
  const budget = {
    reserve: jest.fn().mockResolvedValue(reserved),
    settle: jest.fn().mockResolvedValue(undefined),
    releaseDailyCall: jest.fn().mockResolvedValue(undefined),
  };
  const generator = {
    generate: generateError
      ? jest.fn().mockRejectedValue(generateError)
      : jest.fn().mockResolvedValue(generated),
  };
  const actions = {
    proposeFromSuggestion: jest.fn().mockResolvedValue(
      proposal ?? {
        outcome: 'PENDING_CONFIRMATION',
        action: { id: 'action-1' },
      },
    ),
  };
  const registry = {
    discover: jest.fn().mockReturnValue(capabilities),
    validateInput: jest.fn((_id: string, args: unknown) => args),
  };
  const notifications = { submit: jest.fn().mockResolvedValue({}) };
  const service = new AiProactiveService(
    signals as never,
    budget as never,
    generator as never,
    actions as never,
    registry as never,
    notifications,
  );
  return {
    service,
    signals,
    budget,
    generator,
    actions,
    registry,
    notifications,
  };
}

describe('AiProactiveService', () => {
  it('no razona ni notifica un evento sin relevancia', async () => {
    const { service, budget, generator, notifications } = setup({
      signal: { ...relevantSignal, payload: {} },
    });

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('IGNORED');
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(generator.generate).not.toHaveBeenCalled();
    expect(notifications.submit).not.toHaveBeenCalled();
  });

  it('deja una sola sugerencia por evento y registra su origen', async () => {
    const { service, signals, notifications, budget } = setup();

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('SUGGESTED');
    expect(signals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        signalId: 'signal-1',
        signalType: 'FINANCE.TRANSACTION_DETECTED',
      }),
    );
    expect(notifications.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'AI_PROACTIVE_SUGGESTION',
        requestedChannels: ['IN_APP'],
        deduplicationKey: 'ai-proactive:user-1:signal-1',
      }),
    );
    expect(budget.settle).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostUsd: 0.0002 }),
    );
  });

  it('no crea una segunda sugerencia al reprocesar el mismo evento', async () => {
    const { service, signals, budget, generator } = setup({
      existing: suggestionRow,
    });

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('DUPLICATE');
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(generator.generate).not.toHaveBeenCalled();
    expect(signals.create).not.toHaveBeenCalled();
  });

  it('no duplica cuando la inserción simultánea pierde la clave única', async () => {
    const { service, signals, notifications } = setup({ created: null });

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('DUPLICATE');
    expect(signals.setActionId).not.toHaveBeenCalled();
    expect(notifications.submit).not.toHaveBeenCalled();
  });

  it('sin ritmo ni presupuesto no razona y cuenta el evento omitido', async () => {
    const { service, generator, notifications, signals } = setup({
      reserved: null,
    });

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('LIMITED');
    expect(generator.generate).not.toHaveBeenCalled();
    expect(notifications.submit).not.toHaveBeenCalled();
    expect(signals.recordDiscard).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('deja la acción propuesta pendiente de confirmación', async () => {
    const { service, signals, actions } = setup({
      generated: {
        title: 'Tenés un movimiento por revisar',
        body: 'Quedó esperando una decisión.',
        costUsd: 0.0002,
        action: { actionType: 'finance.resolve-review', arguments: {} },
      },
      capabilities: [
        {
          id: 'finance.resolve-review',
          effect: 'WRITE',
          actionPolicy: 'CONFIRM_REQUIRED',
        },
      ],
    });

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('SUGGESTED');
    expect(actions.proposeFromSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: 'suggestion-1',
        capability: expect.objectContaining({
          actionPolicy: 'CONFIRM_REQUIRED',
        }),
      }),
    );
    expect(signals.setActionId).toHaveBeenCalledWith({
      userId: 'user-1',
      suggestionId: 'suggestion-1',
      actionId: 'action-1',
    });
  });

  it('no propone una acción de lectura ni una que no requiere confirmación', async () => {
    const { service, actions } = setup({
      generated: {
        title: 'Tenés un movimiento por revisar',
        body: 'Quedó esperando una decisión.',
        costUsd: 0.0002,
        action: { actionType: 'finance.read', arguments: {} },
      },
      capabilities: [
        { id: 'finance.read', effect: 'READ', actionPolicy: 'FORBIDDEN' },
      ],
    });

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('SUGGESTED');
    expect(actions.proposeFromSuggestion).not.toHaveBeenCalled();
  });

  it('un fallo del modelo no deja sugerencia ni notificación', async () => {
    const { service, budget, signals, notifications } = setup({
      generateError: new Error('provider down'),
    });

    const decision = await service.consider({
      userId: 'user-1',
      signalId: 'signal-1',
    });

    expect(decision.outcome).toBe('FAILED');
    expect(budget.releaseDailyCall).toHaveBeenCalledWith('user-1');
    expect(signals.create).not.toHaveBeenCalled();
    expect(notifications.submit).not.toHaveBeenCalled();
  });

  it('el listado informa los omitidos de la ventana vigente', async () => {
    const { service, signals } = setup();
    signals.findDiscard.mockResolvedValue({
      windowStartedAt: new Date('2026-11-19T18:03:00.000Z'),
      discarded: 4,
    });

    const list = await service.listForUser('user-1');

    expect(list.suggestions).toEqual([
      expect.objectContaining({
        id: 'suggestion-1',
        signalId: 'signal-1',
        createdAt: '2026-11-19T18:00:00.000Z',
      }),
    ]);
    expect(list.limits.discarded).toBe(0);
    expect(list.limits.windowStartedAt).toBeNull();
  });
});
