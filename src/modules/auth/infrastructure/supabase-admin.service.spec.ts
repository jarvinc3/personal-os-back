import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from './supabase-admin.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('SupabaseAdminService', () => {
  const createClientMock = createClient as jest.MockedFunction<typeof createClient>;

  function buildService(nodeEnv: 'test' | 'development' = 'development') {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return nodeEnv;
        return undefined;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://example.supabase.co';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role';
        throw new Error(`unexpected ${key}`);
      }),
    } as unknown as ConfigService;

    return new SupabaseAdminService(
      config as unknown as ConfigService<never, true>,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no-ops in test env', async () => {
    const service = buildService('test');
    await expect(service.deleteAuthUser('user-1')).resolves.toBeUndefined();
    await expect(service.tryDeleteAuthUser('user-1')).resolves.toEqual({
      ok: true,
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('treats missing auth user as success', async () => {
    createClientMock.mockReturnValue({
      auth: {
        admin: {
          deleteUser: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'User not found', status: 404 },
          }),
        },
      },
    } as never);

    const service = buildService('development');
    await expect(service.tryDeleteAuthUser('user-1')).resolves.toEqual({
      ok: true,
      alreadyMissing: true,
    });
    await expect(service.deleteAuthUser('user-1')).resolves.toBeUndefined();
  });

  it('marks transient provider failures as retryable', async () => {
    createClientMock.mockReturnValue({
      auth: {
        admin: {
          deleteUser: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'rate limited', status: 429 },
          }),
        },
      },
    } as never);

    const service = buildService('development');
    await expect(service.tryDeleteAuthUser('user-1')).resolves.toEqual({
      ok: false,
      message: 'rate limited',
      retryable: true,
    });
    await expect(service.deleteAuthUser('user-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
