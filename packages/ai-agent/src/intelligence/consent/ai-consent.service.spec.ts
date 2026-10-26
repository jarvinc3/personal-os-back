import { AiConsentService } from './ai-consent.service';

describe('AiConsentService', () => {
  const settings = {
    findUnique: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  };
  const event = { create: jest.fn() };
  const prisma = {
    userAiSettings: settings,
    aiConsentEvent: event,
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback(prisma),
    ),
  };
  const service = new AiConsentService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('crea un evento DEFAULT_ON junto con la vista inicial', async () => {
    settings.findUnique.mockResolvedValue(null);
    settings.create.mockResolvedValue({
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

  it('registra revocación y actualiza la vista en la misma transacción', async () => {
    settings.findUnique.mockResolvedValue({
      contributeToGlobalKnowledge: true,
    });
    settings.upsert.mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: new Date('2026-10-25T00:00:00Z'),
    });
    event.create.mockResolvedValue({});
    await service.update('user-1', false);
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
  });

  it('no crea un evento si el valor no cambia', async () => {
    settings.findUnique.mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: new Date('2026-10-24T00:00:00Z'),
    });
    await service.update('user-1', false);
    expect(settings.upsert).not.toHaveBeenCalled();
    expect(event.create).not.toHaveBeenCalled();
  });
});
