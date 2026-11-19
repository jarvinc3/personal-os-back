import { NotFoundException } from '@nestjs/common';
import { ViewSuggestionsService } from './view-suggestions.service';
import { viewSuggestionKey } from './view-suggestion-scope';

const writeCapability = {
  id: 'finance.update_budget',
  moduleSlug: 'finance',
  version: 1,
  description: 'Actualiza un presupuesto',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  effect: 'WRITE' as const,
  actionPolicy: 'CONFIRM_REQUIRED' as const,
};

const actionRow = {
  id: 'action-1',
  actionType: 'finance.update_budget',
  targetModule: 'finance',
  policy: 'CONFIRM_REQUIRED' as const,
  status: 'PENDING' as const,
  payload: { budgetId: 'budget-1' },
};

type SettleCall = { costDate: Date; actualCostUsd: number };

type StoredSuggestion = {
  id: string;
  suggestionKey: string;
  label: string;
  prompt: string;
  actionId: string | null;
};

function fixture() {
  let storedActive: StoredSuggestion[] = [];
  const store = {
    findActive: jest
      .fn()
      .mockImplementation(() => Promise.resolve(storedActive)),
    findKnownKeys: jest.fn().mockResolvedValue([]),
    findExpiredActive: jest.fn().mockResolvedValue([]),
    deleteByIds: jest.fn(),
    createMany: jest.fn().mockImplementation(
      (input: {
        suggestions: Array<{
          suggestionKey: string;
          label: string;
          prompt: string;
        }>;
      }) => {
        storedActive = input.suggestions.map((suggestion, index) => ({
          id: `suggestion-${index + 1}`,
          suggestionKey: suggestion.suggestionKey,
          label: suggestion.label,
          prompt: suggestion.prompt,
          actionId: null,
        }));
        return Promise.resolve(storedActive);
      },
    ),
    setActionId: jest
      .fn()
      .mockImplementation(
        (input: { suggestionId: string; actionId: string }) => {
          storedActive = storedActive.map((suggestion) =>
            suggestion.id === input.suggestionId
              ? { ...suggestion, actionId: input.actionId }
              : suggestion,
          );
          return Promise.resolve();
        },
      ),
    findOwned: jest.fn(),
    dismiss: jest.fn().mockResolvedValue(true),
    findActions: jest.fn().mockResolvedValue([]),
  };
  const budget = {
    reserve: jest.fn().mockResolvedValue(new Date('2026-11-19T00:00:00Z')),
    settle: jest.fn(),
    releaseDailyCall: jest.fn(),
  };
  const generator = {
    generate: jest.fn().mockResolvedValue({
      suggestions: [
        {
          label: 'Revisá el presupuesto del mes',
          prompt: '¿Cómo va el presupuesto de este mes?',
        },
      ],
      costUsd: 0.0004,
    }),
  };
  const actions = {
    proposeFromSuggestion: jest.fn().mockResolvedValue({
      outcome: 'PENDING_CONFIRMATION',
      action: actionRow,
    }),
    cancel: jest.fn().mockResolvedValue({ outcome: 'CANCELLED' }),
  };
  const capabilities = {
    discover: jest.fn().mockReturnValue([]),
    validateInput: jest.fn(),
  };
  const config = { get: jest.fn().mockReturnValue(30) };
  const service = new ViewSuggestionsService(
    store as never,
    budget as never,
    generator as never,
    actions as never,
    capabilities as never,
    config as never,
  );
  return { service, store, budget, generator, actions, capabilities, config };
}

describe('ViewSuggestionsService', () => {
  it('returns cached suggestions without calling the model again', async () => {
    const { service, store, budget, generator } = fixture();
    store.findActive.mockResolvedValue([
      {
        id: 'suggestion-1',
        label: 'Revisá el presupuesto',
        prompt: '¿Cómo va el presupuesto?',
        actionId: 'action-1',
      },
    ]);
    store.findActions.mockResolvedValue([actionRow]);

    await expect(
      service.resolveForView({
        userId: 'user-A',
        route: '/finance',
        view: 'budget',
      }),
    ).resolves.toEqual([
      {
        id: 'suggestion-1',
        label: 'Revisá el presupuesto',
        prompt: '¿Cómo va el presupuesto?',
        action: {
          id: 'action-1',
          actionType: 'finance.update_budget',
          targetModule: 'finance',
          policy: 'CONFIRM_REQUIRED',
          status: 'PENDING',
          payload: { budgetId: 'budget-1' },
        },
      },
    ]);
    expect(store.findActive).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-A',
        route: '/finance',
        viewKey: 'view:budget',
      }),
    );
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('generates, caches and settles the cost of a new set', async () => {
    const { service, store, budget, generator, actions, capabilities } =
      fixture();
    capabilities.discover.mockReturnValue([writeCapability]);
    store.findActions.mockResolvedValue([actionRow]);
    generator.generate.mockResolvedValue({
      suggestions: [
        {
          label: 'Ajustá el presupuesto',
          prompt: 'Ajustá el presupuesto del mes',
          action: {
            actionType: 'finance.update_budget',
            arguments: { budgetId: 'budget-1' },
          },
        },
      ],
      costUsd: 0.0004,
    });

    const suggestions = await service.resolveForView({
      userId: 'user-A',
      route: '/finance',
      view: 'budget',
    });

    expect(generator.generate).toHaveBeenCalledWith({
      userId: 'user-A',
      route: '/finance',
      viewKey: 'view:budget',
    });
    expect(store.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-A',
        route: '/finance',
        viewKey: 'view:budget',
        suggestions: [
          expect.objectContaining({ label: 'Ajustá el presupuesto' }),
        ],
      }),
    );
    expect(budget.settle).toHaveBeenCalledTimes(1);
    const settleCall = budget.settle.mock.calls[0][0] as SettleCall;
    expect(settleCall.costDate).toBeInstanceOf(Date);
    expect(settleCall.actualCostUsd).toBe(0.0004);
    expect(actions.proposeFromSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: 'suggestion-1',
        rawArguments: { budgetId: 'budget-1' },
      }),
    );
    expect(store.setActionId).toHaveBeenCalledWith({
      userId: 'user-A',
      suggestionId: 'suggestion-1',
      actionId: 'action-1',
    });
    expect(suggestions[0].action?.id).toBe('action-1');
  });

  it('leaves the row empty when there is no budget', async () => {
    const { service, budget, generator } = fixture();
    budget.reserve.mockResolvedValue(null);

    await expect(
      service.resolveForView({ userId: 'user-A', route: '/finance' }),
    ).resolves.toEqual([]);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('leaves the row empty and releases the reservation when the model is unavailable', async () => {
    const { service, budget, generator } = fixture();
    generator.generate.mockRejectedValue(new Error('provider down'));

    await expect(
      service.resolveForView({ userId: 'user-A', route: '/finance' }),
    ).resolves.toEqual([]);
    expect(budget.settle).toHaveBeenCalledWith({
      costDate: expect.anything(),
      actualCostUsd: 0,
    });
    expect(budget.releaseDailyCall).toHaveBeenCalledWith('user-A');
  });

  it('does not store a suggestion whose key was already dismissed', async () => {
    const { service, store, generator } = fixture();
    const label = 'Revisá el presupuesto';
    generator.generate.mockResolvedValue({
      suggestions: [{ label, prompt: '¿Cómo va el presupuesto?' }],
      costUsd: 0.0004,
    });
    store.findKnownKeys.mockResolvedValue([viewSuggestionKey(label)]);

    const suggestions = await service.resolveForView({
      userId: 'user-A',
      route: '/finance',
    });

    expect(store.createMany).not.toHaveBeenCalled();
    expect(suggestions).toEqual([]);
  });

  it('resolves two concurrent requests on the same empty view without failing', async () => {
    const { service, store } = fixture();
    const label = 'Revisá el presupuesto';
    const stored = [
      {
        id: 'suggestion-1',
        suggestionKey: viewSuggestionKey(label),
        label,
        prompt: '¿Cómo va el presupuesto?',
        actionId: null,
      },
    ];
    let inserts = 0;
    store.createMany.mockImplementation(() => {
      inserts += 1;
      if (inserts === 1) {
        store.findActive.mockResolvedValue(stored);
        return Promise.resolve(stored);
      }
      return Promise.resolve([]);
    });

    const [first, second] = await Promise.all([
      service.resolveForView({ userId: 'user-A', route: '/finance' }),
      service.resolveForView({ userId: 'user-A', route: '/finance' }),
    ]);

    expect(store.createMany).toHaveBeenCalled();
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
  });

  it('drops actions whose arguments are invalid', async () => {
    const { service, store, generator, actions, capabilities } = fixture();
    capabilities.discover.mockReturnValue([writeCapability]);
    capabilities.validateInput.mockImplementation(() => {
      throw new Error('budgetId is required');
    });
    generator.generate.mockResolvedValue({
      suggestions: [
        {
          label: 'Ajustá el presupuesto',
          prompt: 'Ajustá el presupuesto',
          action: { actionType: 'finance.update_budget', arguments: {} },
        },
      ],
      costUsd: 0.0004,
    });

    const suggestions = await service.resolveForView({
      userId: 'user-A',
      route: '/finance',
    });

    expect(actions.proposeFromSuggestion).not.toHaveBeenCalled();
    expect(store.setActionId).not.toHaveBeenCalled();
    expect(suggestions[0].action).toBeNull();
  });

  it('drops a read capability that cannot be confirmed', async () => {
    const { service, store, generator, actions, capabilities } = fixture();
    capabilities.discover.mockReturnValue([
      { ...writeCapability, effect: 'READ' as const, actionPolicy: undefined },
    ]);
    generator.generate.mockResolvedValue({
      suggestions: [
        {
          label: 'Mirá el resumen',
          prompt: '¿Cuál es el resumen del mes?',
          action: {
            actionType: 'finance.update_budget',
            arguments: { budgetId: 'budget-1' },
          },
        },
      ],
      costUsd: 0.0004,
    });

    await service.resolveForView({ userId: 'user-A', route: '/finance' });

    expect(actions.proposeFromSuggestion).not.toHaveBeenCalled();
    expect(store.setActionId).not.toHaveBeenCalled();
  });

  it('expires old suggestions and cancels their pending actions', async () => {
    const { service, store, actions } = fixture();
    store.findExpiredActive.mockResolvedValue([
      { id: 'old-1', actionId: 'action-old' },
    ]);

    await service.resolveForView({ userId: 'user-A', route: '/finance' });

    expect(actions.cancel).toHaveBeenCalledWith('user-A', 'action-old');
    expect(store.deleteByIds).toHaveBeenCalledWith({
      userId: 'user-A',
      suggestionIds: ['old-1'],
    });
  });

  it('rejects dismissing a suggestion of another user', async () => {
    const { service, store } = fixture();
    store.findOwned.mockResolvedValue(null);

    await expect(
      service.dismiss({ userId: 'user-B', suggestionId: 'suggestion-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(store.dismiss).not.toHaveBeenCalled();
  });

  it('dismisses the suggestion and cancels its pending action', async () => {
    const { service, store, actions } = fixture();
    store.findOwned.mockResolvedValue({
      id: 'suggestion-1',
      status: 'ACTIVE',
      actionId: 'action-1',
    });

    await service.dismiss({ userId: 'user-A', suggestionId: 'suggestion-1' });

    expect(store.dismiss).toHaveBeenCalledWith({
      userId: 'user-A',
      suggestionId: 'suggestion-1',
    });
    expect(actions.cancel).toHaveBeenCalledWith('user-A', 'action-1');
  });

  it('keeps an already dismissed suggestion as dismissed', async () => {
    const { service, store, actions } = fixture();
    store.findOwned.mockResolvedValue({
      id: 'suggestion-1',
      status: 'DISMISSED',
      actionId: null,
    });

    await service.dismiss({ userId: 'user-A', suggestionId: 'suggestion-1' });

    expect(store.dismiss).not.toHaveBeenCalled();
    expect(actions.cancel).not.toHaveBeenCalled();
  });
});
