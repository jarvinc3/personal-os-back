import { ConfigService } from '@nestjs/config';
import { PushSenderService } from './push-sender.service';

const webSubscription = JSON.stringify({
  endpoint: 'https://push.example.com/subscription',
  keys: { p256dh: 'key', auth: 'auth' },
});

describe('PushSenderService', () => {
  const notificationsRepo = {
    deactivatePushTokenByToken: jest.fn().mockResolvedValue({ count: 1 }),
  };

  const fcm = { send: jest.fn() };

  function createService(env: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;

    return new PushSenderService(
      config as never,
      notificationsRepo as never,
      fcm as never,
    );
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    notificationsRepo.deactivatePushTokenByToken.mockClear();
    fcm.send.mockReset();
    fcm.send.mockResolvedValue({ sent: 0, failed: 0, deactivatedTokens: [] });
  });

  it('routes Expo tokens to Expo API', async () => {
    const service = createService({ EXPO_ACCESS_TOKEN: 'expo-token' });

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ status: 'ok' }] }),
    } as Response);

    const result = await service.sendToTokenEntries(
      [{ token: 'ExponentPushToken[abc]', platform: 'ios' }],
      { title: 'Hello', body: 'World' },
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('skips web tokens when VAPID is not configured', async () => {
    const service = createService({});

    const result = await service.sendToTokenEntries(
      [{ token: webSubscription, platform: 'web' }],
      { title: 'Hello', body: 'World' },
    );

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('deactivates invalid tokens via repository helper', async () => {
    const service = createService({});

    await service.deactivateInvalidTokens([webSubscription]);

    expect(notificationsRepo.deactivatePushTokenByToken).toHaveBeenCalledWith(
      webSubscription,
    );
  });
});

describe('PushSenderService channel routing', () => {
  const notificationsRepo = {
    deactivatePushTokenByToken: jest.fn(),
  };

  function createService(fcmSend: jest.Mock) {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    return new PushSenderService(
      config as never,
      notificationsRepo as never,
      { send: fcmSend } as never,
    );
  }

  it('sends android tokens through FCM', async () => {
    const fcmSend = jest
      .fn()
      .mockResolvedValue({ sent: 1, failed: 0, deactivatedTokens: [] });
    const service = createService(fcmSend);

    const result = await service.sendToTokenEntries(
      [{ token: 'fcm-device-token', platform: 'android' }],
      { title: 'Hello', body: 'World' },
    );

    expect(fcmSend).toHaveBeenCalledWith(['fcm-device-token'], {
      title: 'Hello',
      body: 'World',
    });
    expect(result.sent).toBe(1);
  });

  it('ignores ios tokens without failing the send', async () => {
    const fcmSend = jest.fn();
    const service = createService(fcmSend);

    const result = await service.sendToTokenEntries(
      [{ token: 'apns-device-token', platform: 'ios' }],
      { title: 'Hello', body: 'World' },
    );

    expect(fcmSend).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, deactivatedTokens: [] });
  });
});
