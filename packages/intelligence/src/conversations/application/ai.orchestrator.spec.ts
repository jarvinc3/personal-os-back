import {
  AiCapabilityError,
  type AiConversationInferencePort,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
} from '@personal-os/contracts';
import { AiOrchestrator } from './ai.orchestrator';
import { AiContextAssembler } from './ai-context-assembler';
import { AiConversationStore } from './ai-conversation.store';

const readCapability: AiCapabilityDescriptor = {
  id: 'finance_monthly_summary',
  moduleSlug: 'finance',
  version: 1,
  description: 'Monthly finance summary',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  effect: 'READ',
};
const writeCapability: AiCapabilityDescriptor = {
  ...readCapability,
  id: 'finance_create_transaction',
  effect: 'WRITE',
  actionPolicy: 'CONFIRM_REQUIRED',
};

function setup() {
  const conversation = {
    id: 'conversation-1',
    title: 'Nueva conversación',
    summary: null,
    summaryUpdatedAt: null,
    createdAt: new Date('2026-11-02T10:00:00Z'),
    updatedAt: new Date('2026-11-02T10:00:00Z'),
    messages: [] as Array<{
      role: 'user' | 'assistant' | 'tool';
      content: string;
    }>,
  };
  const store = {
    findOwned: jest.fn().mockResolvedValue(conversation),
    append: jest.fn().mockResolvedValue(undefined),
    setTitleFromFirstMessage: jest.fn().mockResolvedValue(undefined),
    setInvocationContext: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
    saveSummary: jest.fn().mockResolvedValue(undefined),
  };
  const assembler = {
    assemble: jest.fn(({ history }: { history: never[] }) => [...history]),
  };
  const inference: jest.Mocked<AiConversationInferencePort> = {
    complete: jest.fn(),
    summarize: jest.fn().mockResolvedValue('Resumen privado'),
  };
  const capabilities: jest.Mocked<AiCapabilityRegistryPort> = {
    discover: jest.fn().mockReturnValue([readCapability, writeCapability]),
    validateInput: jest.fn((_capabilityId, args) => args as never),
    execute: jest
      .fn()
      .mockResolvedValue({ expenses: '1250.00', currency: 'DOP' }),
    readContext: jest.fn().mockResolvedValue({ available: true }),
    resolveEntity: jest.fn().mockResolvedValue({ id: 'entity-1' }),
    register: jest.fn(),
  };
  const actions = {
    propose: jest.fn(),
  };
  const service = new AiOrchestrator(
    store as unknown as AiConversationStore,
    assembler as unknown as AiContextAssembler,
    inference,
    capabilities,
    actions as never,
  );
  return {
    service,
    store,
    assembler,
    inference,
    capabilities,
    actions,
    conversation,
  };
}

describe('AiOrchestrator', () => {
  it('persiste el contexto validado antes de añadir el mensaje', async () => {
    const { service, store, inference } = setup();
    inference.complete.mockResolvedValue({
      content: 'Listo',
      toolCalls: [],
      provider: 'Groq',
      model: 'model-1',
    });
    const context = {
      route: '/finance/products/transactions',
      view: 'transactions',
      entityRef: {
        type: 'transaction',
        id: '00000000-0000-4000-8000-000000000001',
      },
      filters: { month: '2026-11' },
    };
    await service.sendMessage('user-1', 'conversation-1', 'contexto', context);
    expect(store.setInvocationContext).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      context,
    );
  });

  it('rechaza una entidad no resuelta antes de persistir contexto o mensaje', async () => {
    const { service, store, capabilities } = setup();
    capabilities.resolveEntity!.mockResolvedValue(null);
    await expect(
      service.sendMessage('user-1', 'conversation-1', 'contexto', {
        route: '/finance',
        entityRef: {
          type: 'account',
          id: '00000000-0000-4000-8000-000000000002',
        },
      }),
    ).rejects.toThrow('no existe o no pertenece');
    expect(store.setInvocationContext).not.toHaveBeenCalled();
    expect(store.append).not.toHaveBeenCalled();
  });

  it('descubre capacidades READ, ejecuta una herramienta y devuelve datos reales', async () => {
    const { service, store, inference, capabilities } = setup();
    inference.complete
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            name: readCapability.id,
            arguments: { month: '2026-11' },
          },
        ],
        provider: 'Groq',
        model: 'model-1',
      })
      .mockResolvedValueOnce({
        content: 'Gastaste RD$1,250 este mes.',
        toolCalls: [],
        provider: 'Groq',
        model: 'model-1',
      });

    await expect(
      service.sendMessage('user-1', 'conversation-1', '¿Cuánto gasté?'),
    ).resolves.toMatchObject({
      conversationId: 'conversation-1',
      answer: 'Gastaste RD$1,250 este mes.',
      provider: 'Groq',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(inference.complete).toHaveBeenNthCalledWith(1, expect.any(Array), [
      {
        name: readCapability.id,
        description: readCapability.description,
        parameters: readCapability.inputSchema,
        moduleSlug: readCapability.moduleSlug,
        effect: 'READ',
      },
      {
        name: writeCapability.id,
        description: `${writeCapability.description} Política de acción: CONFIRM_REQUIRED.`,
        parameters: writeCapability.inputSchema,
        moduleSlug: writeCapability.moduleSlug,
        effect: 'WRITE',
        actionPolicy: 'CONFIRM_REQUIRED',
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(capabilities.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        correlationId: 'conversation-1',
      }),
      readCapability.id,
      { month: '2026-11' },
    );
    expect(store.append).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      expect.objectContaining({ role: 'tool', toolCallId: 'call-1' }),
    );
  });

  it('envía WRITE a la política y devuelve la acción pendiente sin mutar', async () => {
    const { service, inference, capabilities, actions } = setup();
    inference.complete
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'write-call-1',
            name: writeCapability.id,
            arguments: { month: '2026-11' },
          },
        ],
        provider: 'Groq',
        model: 'model-1',
      })
      .mockResolvedValueOnce({
        content: 'Puedo hacerlo cuando lo confirmes.',
        toolCalls: [],
        provider: 'Groq',
        model: 'model-1',
      });
    actions.propose.mockResolvedValue({
      outcome: 'PENDING_CONFIRMATION',
      action: {
        id: 'action-1',
        actionType: writeCapability.id,
        targetModule: 'finance',
        policy: 'CONFIRM_REQUIRED',
        status: 'PENDING',
        payload: { month: '2026-11' },
        result: null,
        createdAt: new Date('2026-11-02T10:00:00Z'),
      },
    });

    await expect(
      service.sendMessage('user-1', 'conversation-1', 'Haz el cambio'),
    ).resolves.toMatchObject({
      answer: 'Puedo hacerlo cuando lo confirmes.',
      actions: [{ id: 'action-1', outcome: 'PENDING_CONFIRMATION' }],
    });
    expect(actions.propose.mock.calls[0]).toEqual([
      expect.objectContaining({ userId: 'user-1' }),
      writeCapability,
      { month: '2026-11' },
      expect.stringContaining('conversation-1:'),
    ]);
    expect(capabilities.execute.mock.calls).toHaveLength(0);
  });

  it('continúa la conversación cuando una capacidad no está disponible', async () => {
    const { service, inference, capabilities } = setup();
    capabilities.execute.mockRejectedValue(
      new AiCapabilityError('CAPABILITY_UNAVAILABLE', 'private detail'),
    );
    inference.complete
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            name: readCapability.id,
            arguments: { month: '2026-11' },
          },
        ],
        provider: 'Groq',
        model: 'model-1',
      })
      .mockResolvedValueOnce({
        content: 'Finance está desactivado. Puedo ayudarte con otra consulta.',
        toolCalls: [],
        provider: 'Groq',
        model: 'model-1',
      });

    await expect(
      service.sendMessage('user-1', 'conversation-1', '¿Cuánto gasté?'),
    ).resolves.toMatchObject({
      answer: expect.stringContaining('desactivado'),
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(inference.complete).toHaveBeenCalledTimes(2);
    expect(inference.complete.mock.calls[1][0].at(-1)?.content).toContain(
      'CAPABILITY_UNAVAILABLE',
    );
    expect(inference.complete.mock.calls[1][0].at(-1)?.content).not.toContain(
      'private detail',
    );
  });

  it('resume conversaciones largas en un campo privado separado de Knowledge', async () => {
    const { service, store, inference, conversation } = setup();
    conversation.messages = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `mensaje ${index}`,
    }));
    inference.complete.mockResolvedValue({
      content: 'Continuemos.',
      toolCalls: [],
      provider: 'Groq',
      model: 'model-1',
    });

    await service.sendMessage('user-1', 'conversation-1', 'otra pregunta');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(inference.summarize).toHaveBeenCalled();
    expect(store.saveSummary).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      'Resumen privado',
    );
  });
});
