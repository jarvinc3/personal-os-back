import { AiConsentService } from './ai-consent.service';

describe('AiConsentService', () => {
  it('creates default-on consent for a user without a settings row', async () => {
    const upsert = jest.fn().mockResolvedValue({
      contributeToGlobalKnowledge: true,
      contributionConsentAt: new Date('2026-10-24T00:00:00.000Z'),
    });
    const service = new AiConsentService({
      userAiSettings: { upsert },
    } as never);

    await service.get('user-1');

    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', contributeToGlobalKnowledge: true },
      update: {},
      select: {
        contributeToGlobalKnowledge: true,
        contributionConsentAt: true,
      },
    });
  });

  it('records consent revocation with a fresh timestamp', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      contributeToGlobalKnowledge: true,
    });
    const update = jest.fn().mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: new Date(),
    });
    const upsert = jest.fn().mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: new Date(),
    });
    const service = new AiConsentService({
      userAiSettings: { findUnique, update, upsert },
    } as never);

    await service.update('user-1', false);

    expect(update).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: expect.objectContaining({ contributeToGlobalKnowledge: false }),
      }),
    );
  });

  it('does not change the consent timestamp when the value is unchanged', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      contributeToGlobalKnowledge: false,
    });
    const upsert = jest.fn().mockResolvedValue({
      contributeToGlobalKnowledge: false,
      contributionConsentAt: new Date('2026-10-24T00:00:00.000Z'),
    });
    const service = new AiConsentService({
      userAiSettings: { findUnique, upsert },
    } as never);

    await service.update('user-1', false);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });
});
