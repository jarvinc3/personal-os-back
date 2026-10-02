import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '@personal-os/config';
import { SupabaseLogoStorage } from './supabase-logo.storage';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const createClientMock = createClient as jest.MockedFunction<
  typeof createClient
>;

function config(
  values: Partial<Record<keyof Env, string | undefined>> = {},
): ConfigService<Env, true> {
  const map: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ...values,
  };
  return {
    get: (key: string) => map[key],
  } as unknown as ConfigService<Env, true>;
}

describe('SupabaseLogoStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is unavailable without credentials', () => {
    const storage = new SupabaseLogoStorage(
      config({ SUPABASE_URL: undefined }),
    );
    expect(storage.isAvailable()).toBe(false);
    expect(storage.publicUrl('brands/x.png')).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('treats an already-exists upload as success', async () => {
    const upload = jest
      .fn()
      .mockResolvedValue({ error: { message: 'The resource already exists' } });
    createClientMock.mockReturnValue({
      storage: { from: () => ({ upload }) },
    } as never);
    const storage = new SupabaseLogoStorage(config());

    await expect(
      storage.upload('brands/x.png', Buffer.from('x'), {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws on other upload errors', async () => {
    const upload = jest.fn().mockResolvedValue({ error: { message: 'boom' } });
    createClientMock.mockReturnValue({
      storage: { from: () => ({ upload }) },
    } as never);
    const storage = new SupabaseLogoStorage(config());

    await expect(
      storage.upload('brands/x.png', Buffer.from('x'), {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: false,
      }),
    ).rejects.toThrow(/Upload failed: boom/);
  });
});
