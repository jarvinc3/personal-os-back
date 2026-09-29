import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../../../config/env.schema';
import { LogoService, type LogoUploadFile } from './logo.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const createClientMock = createClient as jest.MockedFunction<typeof createClient>;

function storageMock() {
  const list = jest.fn().mockResolvedValue({ data: [] });
  const upload = jest.fn().mockResolvedValue({ error: null });
  const getPublicUrl = jest.fn((path: string) => ({
    data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/logos/${path}` },
  }));
  const from = jest.fn().mockReturnValue({ list, upload, getPublicUrl });
  return { list, upload, getPublicUrl, client: { storage: { from } } };
}

function config(values: Partial<Record<keyof Env, string | undefined>> = {}) {
  const map: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    LOGO_DEV_SECRET_KEY: 'sk_test',
    LOGO_DEV_PUBLISHABLE_KEY: 'pk_test',
    ...values,
  };
  return {
    get: (key: string) => map[key],
  } as unknown as ConfigService<Env, true>;
}

describe('LogoService', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    createClientMock.mockReset();
  });

  it('returns null for an invalid domain without calling the network', async () => {
    const storage = storageMock();
    createClientMock.mockReturnValue(storage.client as never);
    const service = new LogoService(config());

    await expect(service.ensureLogo('not a domain')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('does not store a file when Logo.dev returns 404', async () => {
    const storage = storageMock();
    createClientMock.mockReturnValue(storage.client as never);
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const service = new LogoService(config());

    await expect(service.ensureLogo('missing.example')).resolves.toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
    await expect(service.ensureLogo('https://missing.example/path')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an already-exists upload as success', async () => {
    const storage = storageMock();
    storage.upload.mockResolvedValue({ error: { message: 'The resource already exists' } });
    createClientMock.mockReturnValue(storage.client as never);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });
    const service = new LogoService(config());

    await expect(service.ensureLogo('visa.com')).resolves.toBe('brands/visa.com.png');
  });

  it('prefers a custom logo over the shared brand and the legacy URL', () => {
    const storage = storageMock();
    createClientMock.mockReturnValue(storage.client as never);
    const service = new LogoService(config());

    expect(
      service.resolveUrl({
        customLogoPath: 'custom/user/inst.png',
        logoPath: 'brands/bhd.com.do.png',
        logoUrl: 'https://legacy.example/logo.png',
      }),
    ).toBe(
      'https://example.supabase.co/storage/v1/object/public/logos/custom/user/inst.png',
    );
    expect(
      service.resolveUrl({
        logoPath: 'brands/bhd.com.do.png',
        logoUrl: 'https://legacy.example/logo.png',
      }),
    ).toContain('brands/bhd.com.do.png');
    expect(service.resolveUrl({ logoUrl: 'https://legacy.example/logo.png' })).toBe(
      'https://legacy.example/logo.png',
    );
  });

  it('rejects svg uploads and files over 1 MB', async () => {
    const storage = storageMock();
    createClientMock.mockReturnValue(storage.client as never);
    const service = new LogoService(config());
    const svg: LogoUploadFile = {
      mimetype: 'image/svg+xml',
      size: 10,
      buffer: Buffer.from('<svg></svg>'),
    };
    await expect(service.saveCustomLogo('user', 'inst', svg)).rejects.toThrow(
      /PNG, JPG o WEBP/,
    );
    const huge: LogoUploadFile = {
      mimetype: 'image/png',
      size: 1_000_001,
      buffer: Buffer.from('x'),
    };
    await expect(service.saveCustomLogo('user', 'inst', huge)).rejects.toThrow(
      /1 MB/,
    );
  });

  it('returns no network logo for OTHER', () => {
    const storage = storageMock();
    createClientMock.mockReturnValue(storage.client as never);
    const service = new LogoService(config());
    expect(service.networkLogoUrl('OTHER')).toBeNull();
    expect(service.networkLogoUrl(null)).toBeNull();
  });
});
