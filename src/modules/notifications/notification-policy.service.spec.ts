import { UsersRepository } from '../users/users.repository';
import { NotificationPolicyService } from './notification-policy.service';

describe('NotificationPolicyService', () => {
  const usersRepository = {
    findById: jest.fn(),
  } as unknown as UsersRepository;

  const service = new NotificationPolicyService(usersRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks IN_APP when channel disabled', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: false },
          quietHours: { enabled: false, start: '22:00', end: '08:00', timezone: null },
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
        quietHours: { enabled: true, start: '00:00', end: '23:59', timezone: null },
      },
    };

    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'UTC',
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
      preferences: {
        notifications: {
          channels: { push: true, email: false, inApp: true },
          quietHours: { enabled: false, start: '22:00', end: '08:00', timezone: null },
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

  it('blocks finance transaction notifications when transactionDetected is false', async () => {
    usersRepository.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Santo_Domingo',
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
});
