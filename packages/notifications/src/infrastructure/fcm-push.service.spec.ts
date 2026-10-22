import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';

const mockSendEachForMulticast = jest.fn();
const mockInitializeApp = jest.fn(() => ({ name: 'personal-os-push' }));
const mockCert = jest.fn(() => ({}));

jest.mock('firebase-admin/app', () => ({
  cert: (...args: unknown[]) => mockCert(...(args as [])),
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

const PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END PRIVATE KEY-----\n';
const ESCAPED_PRIVATE_KEY = PRIVATE_KEY.replace(/\n/g, '\\n');

const validCredential = {
  FIREBASE_PROJECT_ID: 'personal-os-496605',
  FIREBASE_CLIENT_EMAIL: 'push@example.test',
  FIREBASE_PRIVATE_KEY: ESCAPED_PRIVATE_KEY,
};

describe('FcmPushService', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  function createService(env: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService<Env, true>;

    return new FcmPushService(config);
  }

  function mockSuccessfulSend() {
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });
  }

  beforeEach(() => {
    mockSendEachForMulticast.mockReset();
    mockInitializeApp.mockClear();
    mockCert.mockReset();
    mockCert.mockReturnValue({});
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing when there are no tokens', async () => {
    const service = createService({});

    await expect(service.send([], { title: 'a', body: 'b' })).resolves.toEqual({
      sent: 0,
      failed: 0,
      deactivatedTokens: [],
    });
  });

  it('logs FCM skipped on boot when no credential is set', async () => {
    const service = createService({});

    await service.onModuleInit();

    expect(warnSpy).toHaveBeenCalledWith(
      'FCM skipped: missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    );
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it('keeps the channel off and names the missing variables', async () => {
    const service = createService({});

    await expect(
      service.send(['token-1'], { title: 'a', body: 'b' }),
    ).resolves.toEqual({ sent: 0, failed: 1, deactivatedTokens: [] });
    expect(warnSpy).toHaveBeenCalledWith(
      'FCM skipped: missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'FCM skipped: credential not configured',
    );
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  it('sends through FCM with the escaped private key', async () => {
    const service = createService(validCredential);
    mockSuccessfulSend();

    await expect(
      service.send(['token-1'], {
        title: 'Vence tu tarjeta',
        body: 'Mañana',
        data: { notificationId: 'n-1', isRead: false },
      }),
    ).resolves.toEqual({ sent: 1, failed: 0, deactivatedTokens: [] });

    expect(mockCert).toHaveBeenCalledWith({
      projectId: 'personal-os-496605',
      clientEmail: 'push@example.test',
      privateKey: PRIVATE_KEY,
    });
    expect(mockInitializeApp).toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['token-1'],
      notification: { title: 'Vence tu tarjeta', body: 'Mañana' },
      data: { notificationId: 'n-1', isRead: 'false' },
    });
  });

  it('accepts a private key with real line breaks', async () => {
    const service = createService({
      ...validCredential,
      FIREBASE_PRIVATE_KEY: PRIVATE_KEY,
    });
    mockSuccessfulSend();

    await service.send(['token-1'], { title: 'a', body: 'b' });

    expect(mockCert).toHaveBeenCalledWith({
      projectId: 'personal-os-496605',
      clientEmail: 'push@example.test',
      privateKey: PRIVATE_KEY,
    });
  });

  it('names only the missing variables when two are set', async () => {
    const service = createService({
      FIREBASE_PROJECT_ID: 'personal-os-496605',
      FIREBASE_CLIENT_EMAIL: 'push@example.test',
    });

    await expect(
      service.send(['token-1'], { title: 'a', body: 'b' }),
    ).resolves.toEqual({ sent: 0, failed: 1, deactivatedTokens: [] });

    expect(warnSpy).toHaveBeenCalledWith(
      'FCM skipped: missing FIREBASE_PRIVATE_KEY',
    );
    const logged = warnSpy.mock.calls.map((call) => String(call[0])).join(' ');
    expect(logged).not.toContain('personal-os-496605');
    expect(logged).not.toContain('push@example.test');
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it('ignores the removed service account variables', async () => {
    const service = createService({
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'personal-os-496605',
        private_key: PRIVATE_KEY,
      }),
      FIREBASE_SERVICE_ACCOUNT_PATH: '/tmp/firebase-service-account.json',
    });

    await expect(
      service.send(['token-1'], { title: 'a', body: 'b' }),
    ).resolves.toEqual({ sent: 0, failed: 1, deactivatedTokens: [] });

    expect(warnSpy).toHaveBeenCalledWith(
      'FCM skipped: missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    );
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it('stays off and hides a malformed private key from the log', async () => {
    const service = createService(validCredential);
    mockCert.mockImplementationOnce(() => {
      throw new Error(`Invalid PEM block: ${PRIVATE_KEY}`);
    });

    await expect(
      service.send(['token-1'], { title: 'a', body: 'b' }),
    ).resolves.toEqual({ sent: 0, failed: 1, deactivatedTokens: [] });

    expect(mockInitializeApp).not.toHaveBeenCalled();
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('FCM credential could not be loaded');
    expect(logged).toContain('[redacted private key]');
    expect(logged).not.toContain(
      'MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA',
    );
  });

  it('deactivates the tokens FCM reports as dead and keeps the rest', async () => {
    const service = createService(validCredential);
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
});
