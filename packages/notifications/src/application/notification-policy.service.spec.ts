import type { ModuleSettingsReader } from '@personal-os/contracts';
import type { UsersRepositoryPort } from '@personal-os/users';
import { NotificationPolicyService } from './notification-policy.service';

const BASE_PREFERENCES = {
  notifications: {
    channels: { push: true, email: false, inApp: true },
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00',
      timezone: null,
    },
  },
};

describe('NotificationPolicyService', () => {
  const usersRepository = {
    findById: jest.fn(),
  } as unknown as UsersRepositoryPort;

  const hasDescriptor = jest.fn();
  const read = jest.fn();
  const notificationEnabled = jest.fn();
  const settings = {
    hasDescriptor,
    read,
    notificationEnabled,
  } as unknown as ModuleSettingsReader;

  const service = new NotificationPolicyService(usersRepository, settings);

  function existingUser(preferences: unknown = BASE_PREFERENCES) {
    return {
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences,
      userModules: [],
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    hasDescriptor.mockReturnValue(true);
    read.mockResolvedValue({ enabled: true, version: 2, config: {} });
    notificationEnabled.mockResolvedValue(true);
    usersRepository.findById = jest.fn().mockResolvedValue(existingUser());
  });

  it('blocks IN_APP when channel disabled', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue(
      existingUser({
        notifications: {
          channels: { push: true, email: false, inApp: false },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: null,
          },
        },
      }),
    );

    const decision = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('channel_in_app_disabled');
    }
  });

  it('blocks PUSH during quiet hours but allows IN_APP', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue(
      existingUser({
        notifications: {
          channels: { push: true, email: true, inApp: true },
          quietHours: {
            enabled: true,
            start: '00:00',
            end: '23:59',
            timezone: null,
          },
        },
      }),
    );

    const pushResult = await service.evaluate({
      userId: 'user-1',
      channel: 'PUSH',
    });
    const inAppResult = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
    });

    expect(pushResult.allowed).toBe(false);
    expect(inAppResult.allowed).toBe(true);
  });

  it('blocks module notification when toggle is false', async () => {
    notificationEnabled.mockResolvedValue(false);

    const decision = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      data: { moduleSlug: 'finance', notificationKey: 'budgetAlerts' },
    });

    expect(decision.allowed).toBe(false);
  });

  it('reads the module toggle from the dispatch context', async () => {
    notificationEnabled.mockResolvedValue(false);

    const decision = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      sourceDomain: 'finance',
      preferenceKey: 'budgetAlerts',
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe(
        'module_notification_disabled:finance.budgetAlerts',
      );
    }
    expect(notificationEnabled).toHaveBeenCalledWith(
      'user-1',
      'finance',
      'budgetAlerts',
    );
  });

  it('blocks finance transaction notifications when transactionDetected is false', async () => {
    notificationEnabled.mockResolvedValue(false);

    const decision = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      data: {
        moduleSlug: 'finance',
        notificationKey: 'transactionDetected',
      },
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe(
        'module_notification_disabled:finance.transactionDetected',
      );
    }
  });

  it('blocks subscription renewals when subscriptionReminders is false', async () => {
    notificationEnabled.mockResolvedValue(false);

    const subscriptionResult = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      data: {
        moduleSlug: 'finance',
        notificationKey: 'subscriptionReminders',
      },
    });

    expect(subscriptionResult.allowed).toBe(false);
    if (!subscriptionResult.allowed) {
      expect(subscriptionResult.reason).toBe(
        'module_notification_disabled:finance.subscriptionReminders',
      );
    }
  });

  it('blocks price increase alerts when priceIncreaseAlerts is false', async () => {
    notificationEnabled.mockResolvedValue(false);

    const priceResult = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      data: {
        moduleSlug: 'finance',
        notificationKey: 'priceIncreaseAlerts',
      },
    });

    expect(priceResult.allowed).toBe(false);
    if (!priceResult.allowed) {
      expect(priceResult.reason).toBe(
        'module_notification_disabled:finance.priceIncreaseAlerts',
      );
    }
  });

  it('blocks when the module is missing or disabled', async () => {
    read.mockResolvedValue({ enabled: false, version: 2, config: {} });

    const decision = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      sourceDomain: 'finance',
      preferenceKey: 'budgetAlerts',
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('module_disabled_or_missing');
    }
    expect(notificationEnabled).not.toHaveBeenCalled();
  });

  it('allows a domain without a registered descriptor', async () => {
    hasDescriptor.mockReturnValue(false);

    await expect(
      service.evaluate({
        userId: 'user-1',
        channel: 'IN_APP',
        sourceDomain: 'unknown',
        preferenceKey: 'anything',
      }),
    ).resolves.toEqual({ allowed: true });
    expect(read).not.toHaveBeenCalled();
    expect(notificationEnabled).not.toHaveBeenCalled();
  });

  it('resolves a preference for another module through the same reader', async () => {
    notificationEnabled.mockResolvedValue(false);

    const decision = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      sourceDomain: 'agenda',
      preferenceKey: 'eventReminders',
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe(
        'module_notification_disabled:agenda.eventReminders',
      );
    }
    expect(notificationEnabled).toHaveBeenCalledWith(
      'user-1',
      'agenda',
      'eventReminders',
    );
  });

  it('rejects notifications from a missing user', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue(null);

    await expect(
      service.evaluate({ userId: 'user-1', channel: 'IN_APP' }),
    ).resolves.toEqual({ allowed: false, reason: 'user_not_found' });
  });
});
