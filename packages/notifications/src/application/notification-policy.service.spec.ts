import type { ModuleSettingsRegistry } from '@personal-os/contracts';
import { FINANCE_SETTINGS_DESCRIPTOR } from '@personal-os/finance';
import type { UsersRepositoryPort } from '@personal-os/users';
import { NotificationPolicyService } from './notification-policy.service';

describe('NotificationPolicyService', () => {
  const usersRepository = {
    findById: jest.fn(),
  } as unknown as UsersRepositoryPort;

  const settingsRegistry = {
    has: (slug: string) => slug === FINANCE_SETTINGS_DESCRIPTOR.slug,
    get: (slug: string) => {
      if (slug !== FINANCE_SETTINGS_DESCRIPTOR.slug) {
        throw new Error(`Settings descriptor not registered: ${slug}`);
      }
      return FINANCE_SETTINGS_DESCRIPTOR;
    },
  } as unknown as ModuleSettingsRegistry;

  const service = new NotificationPolicyService(
    usersRepository,
    settingsRegistry,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks IN_APP when channel disabled', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: false },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: null,
          },
        },
      },
      userModules: [],
    });

    const result = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('channel_in_app_disabled');
    }
  });

  it('blocks PUSH during quiet hours but allows IN_APP', async () => {
    const prefs = {
      notifications: {
        channels: { push: true, email: true, inApp: true },
        quietHours: {
          enabled: true,
          start: '00:00',
          end: '23:59',
          timezone: null,
        },
      },
    };

    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'UTC',
      locale: 'es-DO',
      preferences: prefs,
      userModules: [],
    });

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
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: true },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: null,
          },
        },
      },
      userModules: [
        {
          isEnabled: true,
          module: { slug: 'finance' },
          config: {
            notifications: { budgetAlerts: false },
          },
        },
      ],
    });

    const result = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      data: { moduleSlug: 'finance', notificationKey: 'budgetAlerts' },
    });

    expect(result.allowed).toBe(false);
  });

  it('reads the module toggle from the dispatch context', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: true },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: null,
          },
        },
      },
      userModules: [
        {
          isEnabled: true,
          module: { slug: 'finance' },
          config: {
            notifications: { budgetAlerts: false },
          },
        },
      ],
    });

    const decision = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      moduleSlug: 'finance',
      preferenceKey: 'budgetAlerts',
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe(
        'module_notification_disabled:finance.budgetAlerts',
      );
    }
  });

  it('blocks finance transaction notifications when transactionDetected is false', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: true },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: null,
          },
        },
      },
      userModules: [
        {
          isEnabled: true,
          module: { slug: 'finance' },
          config: {
            notifications: { transactionDetected: false },
          },
        },
      ],
    });

    const result = await service.evaluate({
      userId: 'user-1',
      channel: 'IN_APP',
      data: {
        moduleSlug: 'finance',
        notificationKey: 'transactionDetected',
      },
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe(
        'module_notification_disabled:finance.transactionDetected',
      );
    }
  });

  it('blocks subscription renewals when subscriptionReminders is false', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: true },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: null,
          },
        },
      },
      userModules: [
        {
          isEnabled: true,
          module: { slug: 'finance' },
          config: {
            notifications: { subscriptionReminders: false },
          },
        },
      ],
    });

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
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: true },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: null,
          },
        },
      },
      userModules: [
        {
          isEnabled: true,
          module: { slug: 'finance' },
          config: {
            notifications: { priceIncreaseAlerts: false },
          },
        },
      ],
    });

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
});
