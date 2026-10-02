import { ConfigService } from '@nestjs/config';
import { ResendEmailAdapter } from './resend-email.adapter';

describe('ResendEmailAdapter', () => {
  function createAdapter(env: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;

    return new ResendEmailAdapter(config as never);
  }

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('posts to Resend API on success', async () => {
    const adapter = createAdapter({
      RESEND_API_KEY: 're_test',
      MAIL_FROM: 'Personal OS <notify@example.com>',
    });

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"id":"email_1"}'),
    } as Response);

    await adapter.send({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'World',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          from: 'Personal OS <notify@example.com>',
          to: ['user@example.com'],
          subject: 'Hello',
          text: 'World',
        }),
      }),
    );
  });

  it('throws when Resend returns a non-2xx response', async () => {
    const adapter = createAdapter({
      RESEND_API_KEY: 're_test',
      MAIL_FROM: 'notify@example.com',
    });

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('{"message":"invalid"}'),
    } as Response);

    await expect(
      adapter.send({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'World',
      }),
    ).rejects.toThrow(/Resend API error 422/);
  });

  it('throws when API key or MAIL_FROM is missing', async () => {
    const adapter = createAdapter({});

    await expect(
      adapter.send({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'World',
      }),
    ).rejects.toThrow(/RESEND_API_KEY or MAIL_FROM/);
  });
});
