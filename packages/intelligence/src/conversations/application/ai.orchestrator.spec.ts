import {
  AiCapabilityError,
  type AiConversationInferencePort,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
} from '@personal-os/contracts';
import { AiOrchestrator } from './ai.orchestrator';
import { AiContextAssembler } from './ai-context-assembler';
import { AiConversationStore } from './ai-conversation.store';
import { aiInvocationContextKey } from './ai-invocation-context-key';

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
    findTurn: jest.fn().mockResolvedValue({ user: null, assistant: null }),
    append: jest.fn().mockResolvedValue(undefined),
    appendTurn: jest.fn().mockResolvedValue(undefined),
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
    stream: jest.fn(),
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
    await service.sendMessage({
      userId: 'user-1',
      conversationId: 'conversation-1',
      content: 'contexto',
      context,
    });
    expect(store.setInvocationContext).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      context,
      aiInvocationContextKey(context),
    );
  });

  it('persiste la clave canónica al crear una conversación contextual', async () => {
    const { service, store } = setup();
    const context = {
      route: '/finance/products/transactions',
      filters: { month: '2026-11' },
    };

    await service.createConversation('user-1', context);

    expect(store.create).toHaveBeenCalledWith(
      'user-1',
      context,
      aiInvocationContextKey(context),
    );
  });

  it('rechaza una entidad no resuelta antes de persistir contexto o mensaje', async () => {
    const { service, store, capabilities } = setup();
    capabilities.resolveEntity!.mockResolvedValue(null);
    await expect(
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: 'contexto',
        context: {
          route: '/finance',
          entityRef: {
            type: 'account',
            id: '00000000-0000-4000-8000-000000000002',
          },
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
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: '¿Cuánto gasté?',
      }),
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
    expect(store.appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        conversationId: 'conversation-1',
        messages: expect.arrayContaining([
          expect.objectContaining({
            message: expect.objectContaining({
              role: 'tool',
              toolCallId: 'call-1',
            }),
          }),
        ]),
      }),
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
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: 'Haz el cambio',
      }),
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
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: '¿Cuánto gasté?',
      }),
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

    await service.sendMessage({
      userId: 'user-1',
      conversationId: 'conversation-1',
      content: 'otra pregunta',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(inference.summarize).toHaveBeenCalled();
    expect(store.saveSummary).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      'Resumen privado',
    );
  });

  it('replays a saved turn without calling the model again', async () => {
    const { service, store, inference } = setup();
    const createdAt = new Date('2026-11-19T10:00:00Z');
    store.findTurn.mockResolvedValue({
      user: {
        id: 'message-user',
        role: 'user',
        content: '¿Cuánto gasté?',
        clientMessageId: 'turn-1',
        provider: null,
        model: null,
        createdAt,
      },
      assistant: {
        id: 'message-assistant',
        role: 'assistant',
        content: 'Gastaste RD$1,250.',
        clientMessageId: 'turn-1',
        provider: 'Groq',
        model: 'model-1',
        createdAt,
      },
    });
    const events: Array<{ type: string }> = [];

    await expect(
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: '¿Cuánto gasté?',
        clientMessageId: 'turn-1',
        onEvent: (event) => events.push(event),
      }),
    ).resolves.toMatchObject({
      answer: 'Gastaste RD$1,250.',
      provider: 'Groq',
      model: 'model-1',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(inference.complete).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'chunk',
      'done',
    ]);
  });

  it('retries a failed turn without appending the user message twice', async () => {
    const { service, store, inference } = setup();
    const createdAt = new Date('2026-11-19T10:00:00Z');
    store.findTurn.mockResolvedValue({
      user: {
        id: 'message-user',
        role: 'user',
        content: '¿Cuánto gasté?',
        clientMessageId: 'turn-1',
        provider: null,
        model: null,
        createdAt,
      },
      assistant: null,
    });
    inference.complete.mockResolvedValue({
      content: 'Gastaste RD$1,250.',
      toolCalls: [],
      provider: 'Groq',
      model: 'model-1',
    });

    await expect(
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: '¿Cuánto gasté?',
        clientMessageId: 'turn-1',
      }),
    ).resolves.toMatchObject({ answer: 'Gastaste RD$1,250.' });
    expect(store.append).not.toHaveBeenCalled();
    expect(store.appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            message: expect.objectContaining({
              role: 'assistant',
              content: 'Gastaste RD$1,250.',
            }),
            clientMessageId: 'turn-1',
            provider: 'Groq',
            model: 'model-1',
          }),
        ]),
      }),
    );
  });

  it('rejects the same client message id with different content', async () => {
    const { service, store, inference } = setup();
    store.findTurn.mockResolvedValue({
      user: {
        id: 'message-user',
        role: 'user',
        content: 'Otro mensaje',
        clientMessageId: 'turn-1',
        provider: null,
        model: null,
        createdAt: new Date('2026-11-19T10:00:00Z'),
      },
      assistant: null,
    });

    await expect(
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: '¿Cuánto gasté?',
        clientMessageId: 'turn-1',
      }),
    ).rejects.toThrow('otro contenido');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(inference.complete).not.toHaveBeenCalled();
    expect(store.append).not.toHaveBeenCalled();
    expect(store.appendTurn).not.toHaveBeenCalled();
  });

  it('streams chunks and resets when a tool call follows partial text', async () => {
    const { service, store, inference, capabilities } = setup();
    inference.stream
      .mockImplementationOnce(({ onContent }) => {
        onContent('Voy a revisar');
        return Promise.resolve({
          content: 'Voy a revisar',
          toolCalls: [
            {
              id: 'call-1',
              name: readCapability.id,
              arguments: { month: '2026-11' },
            },
          ],
          provider: 'Groq',
          model: 'model-1',
        });
      })
      .mockImplementationOnce(({ onContent }) => {
        onContent('Gastaste RD$1,250.');
        return Promise.resolve({
          content: 'Gastaste RD$1,250.',
          toolCalls: [],
          provider: 'Groq',
          model: 'model-1',
        });
      });
    const events: Array<{ type: string; content?: string }> = [];

    await expect(
      service.sendMessage({
        userId: 'user-1',
        conversationId: 'conversation-1',
        content: '¿Cuánto gasté?',
        onEvent: (event) => events.push(event),
      }),
    ).resolves.toMatchObject({ answer: 'Gastaste RD$1,250.' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(inference.complete).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'chunk',
      'status',
      'reset',
      'chunk',
      'done',
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(capabilities.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      readCapability.id,
      { month: '2026-11' },
    );
    expect(store.appendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            message: expect.objectContaining({
              role: 'tool',
              toolCallId: 'call-1',
            }),
          }),
        ]),
      }),
    );
  });
});
