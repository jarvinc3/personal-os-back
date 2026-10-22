import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';

const mockSendEachForMulticast = jest.fn();
const mockInitializeApp = jest.fn(() => ({ name: 'personal-os-push' }));

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(() => ({})),
  getApps: jest.fn(() => []),
  initializeApp: (...args: unknown[]) => mockInitializeApp(...(args as [])),
}));

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({
    sendEachForMulticast: (...args: unknown[]) =>
      mockSendEachForMulticast(...(args as [])),
  })),
}));

import { FcmPushService } from './fcm-push.service';

describe('FcmPushService', () => {
  function createService(env: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService<Env, true>;

    return new FcmPushService(config);
  }

  beforeEach(() => {
    mockSendEachForMulticast.mockReset();
    mockInitializeApp.mockClear();
  });

  it('does nothing when there are no tokens', async () => {
    const service = createService({});

    await expect(service.send([], { title: 'a', body: 'b' })).resolves.toEqual({
      sent: 0,
      failed: 0,
      deactivatedTokens: [],
    });
  });

  it('counts the tokens as failed and keeps going without a credential', async () => {
    const service = createService({});

    await expect(
      service.send(['token-1'], { title: 'a', body: 'b' }),
    ).resolves.toEqual({ sent: 0, failed: 1, deactivatedTokens: [] });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  it('sends through FCM with the inline service account', async () => {
    const service = createService({
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'personal-os-496605',
        client_email: 'push@example.test',
        private_key: 'key',
      }),
    });
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    await expect(
      service.send(['token-1'], {
        title: 'Vence tu tarjeta',
        body: 'Mañana',
        data: { notificationId: 'n-1', isRead: false },
      }),
    ).resolves.toEqual({ sent: 1, failed: 0, deactivatedTokens: [] });

    expect(mockInitializeApp).toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['token-1'],
      notification: { title: 'Vence tu tarjeta', body: 'Mañana' },
      data: { notificationId: 'n-1', isRead: 'false' },
    });
  });

  it('deactivates the tokens FCM reports as dead and keeps the rest', async () => {
    const service = createService({
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'p' }),
    });
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
      ],
    });

    await expect(
      service.send(['token-1', 'token-dead'], { title: 'a', body: 'b' }),
    ).resolves.toEqual({
      sent: 1,
      failed: 1,
      deactivatedTokens: ['token-dead'],
    });
  });

  it('stays off when the credential cannot be parsed', async () => {
    const service = createService({ FIREBASE_SERVICE_ACCOUNT_JSON: '{nope' });

    await expect(
      service.send(['token-1'], { title: 'a', body: 'b' }),
    ).resolves.toEqual({ sent: 0, failed: 1, deactivatedTokens: [] });
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });
});
