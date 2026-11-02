import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AiIntelligenceController } from './ai-intelligence.controller';

function makeController({
  completeAuthorization,
}: {
  completeAuthorization: jest.Mock;
}) {
  const email = { completeAuthorization };
  const sync = {
    syncConnection: jest.fn().mockResolvedValue({ connected: true }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'CORS_ORIGIN' ? 'http://localhost:3000' : undefined,
    ),
  };
  const controller = new AiIntelligenceController(
    email as never,
    sync as never,
    config as never,
  );
  const redirect = jest.fn((url: string) => url);
  const response = { redirect } as unknown as Response;

  return { controller, sync, redirect, response };
}

describe('AiIntelligenceController callback OAuth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redirige conectado y arranca la sincronización tras guardar OAuth', async () => {
    const completeAuthorization = jest
      .fn()
      .mockResolvedValue({ id: 'connection-1' });
    const { controller, sync, redirect, response } = makeController({
      completeAuthorization,
    });

    await controller.callback('code', 'state', undefined, response);

    expect(sync.syncConnection).toHaveBeenCalledWith('connection-1');
    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining('gmail=connected'),
    );
  });

  it('registra el fallo del sync en segundo plano sin romper la redirección', async () => {
    const completeAuthorization = jest
      .fn()
      .mockResolvedValue({ id: 'connection-1' });
    const { controller, sync, redirect, response } = makeController({
      completeAuthorization,
    });
    sync.syncConnection.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'gmail_token_refresh_failed',
        providerCode: 'timeout',
      }),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await controller.callback('code', 'state', undefined, response);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining('gmail=connected'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Gmail sync after OAuth failed'),
    );
    expect(warn.mock.calls[0][0]).toContain('timeout');
  });

  it('registra el fallo de la autorización y redirige a error', async () => {
    const completeAuthorization = jest.fn().mockRejectedValue(
      new BadRequestException({
        code: 'gmail_oauth_exchange_failed',
        providerCode: 'invalid_grant',
      }),
    );
    const { controller, redirect, response } = makeController({
      completeAuthorization,
    });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await controller.callback('code', 'state', undefined, response);

    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining('gmail=error'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Gmail OAuth callback failed'),
    );
    expect(warn.mock.calls[0][0]).toContain('invalid_grant');
  });
});
