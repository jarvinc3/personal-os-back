import { AiConsentService } from './ai-consent.service';

const consentDate = new Date('2026-10-25T00:00:00Z');

describe('AiConsentService', () => {
  const settings = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  };
  const event = { create: jest.fn() };
  const knowledgeRows = { updateMany: jest.fn() };
  const prisma = {
    userAiSettings: settings,
    aiConsentEvent: event,
    aiKnowledge: knowledgeRows,
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback(prisma),
    ),
  };
  const knowledge = { rebuild: jest.fn() };
  const service = new AiConsentService(prisma as never, knowledge as never);

  beforeEach(() => {
    jest.clearAllMocks();
    knowledge.rebuild.mockResolvedValue({});
    knowledgeRows.updateMany.mockResolvedValue({ count: 0 });
  });

  it('crea un evento DEFAULT_ON junto con la vista inicial', async () => {
    settings.findUnique.mockResolvedValue(null);
    settings.upsert.mockResolvedValue({
      contributeToGlobalKnowledge: true,
      contributionConsentAt: new Date('2026-10-24T00:00:00Z'),
    });
    event.create.mockResolvedValue({});
    expect(await service.get('user-1')).toEqual({
      contributeToGlobalKnowledge: true,
      contributionConsentAt: new Date('2026-10-24T00:00:00Z'),
    });
    expect(event.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        contributeToGlobalKnowledge: true,
        reason: 'DEFAULT_ON',
      },
    });
  });

  it('marca GLOBAL en revisión y reconstruye al revocar', async () => {
    settings.findUnique.mockResolvedValue({
      contributeToGlobalKnowledge: true,
      contributionConsentAt: consentDate,
    });
    settings.upsert.mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: consentDate,
    });
    event.create.mockResolvedValue({});

    await expect(service.update('user-1', false)).resolves.toEqual({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: consentDate,
    });

    expect(settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ contributeToGlobalKnowledge: false }),
      }),
    );
    expect(event.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        contributeToGlobalKnowledge: false,
        reason: 'USER_CHANGE',
      },
    });
    expect(knowledgeRows.updateMany).toHaveBeenCalledWith({
      where: { scope: 'GLOBAL' },
      data: { state: 'REVIEW_REQUIRED', promotedBy: null },
    });
    expect(knowledge.rebuild).toHaveBeenCalledWith('user-1');
  });

  it('no crea evento ni toca GLOBAL si el valor no cambia', async () => {
    settings.findUnique.mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: consentDate,
    });

    await service.update('user-1', false);

    expect(settings.upsert).not.toHaveBeenCalled();
    expect(event.create).not.toHaveBeenCalled();
    expect(knowledgeRows.updateMany).not.toHaveBeenCalled();
    expect(knowledge.rebuild).not.toHaveBeenCalled();
  });

  it('activar la contribución no pausa GLOBAL ni reconstruye', async () => {
    settings.findUnique.mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: consentDate,
    });
    settings.upsert.mockResolvedValue({
      contributeToGlobalKnowledge: true,
      contributionConsentAt: consentDate,
    });
    event.create.mockResolvedValue({});

    await service.update('user-1', true);

    expect(knowledgeRows.updateMany).not.toHaveBeenCalled();
    expect(knowledge.rebuild).not.toHaveBeenCalled();
  });

  it('mantiene la revocación si el rebuild falla', async () => {
    settings.findUnique.mockResolvedValue({
      contributeToGlobalKnowledge: true,
      contributionConsentAt: consentDate,
    });
    settings.upsert.mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: consentDate,
    });
    event.create.mockResolvedValue({});
    knowledge.rebuild.mockRejectedValue(new Error('database unavailable'));

    await expect(service.update('user-1', false)).resolves.toEqual({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: consentDate,
    });
    expect(knowledgeRows.updateMany).toHaveBeenCalled();
  });
});
