import type { BrandLogoPort } from './ports/brand-logo.port';
import type { LogoStoragePort } from './ports/logo-storage.port';
import { LogoService, type LogoUploadFile } from './logo.service';

type StorageMocks = {
  port: LogoStoragePort;
  exists: jest.Mock;
  upload: jest.Mock;
};

function storagePort(
  params: {
    exists?: jest.Mock;
    upload?: jest.Mock;
    available?: boolean;
  } = {},
): StorageMocks {
  const exists = params.exists ?? jest.fn().mockResolvedValue(false);
  const upload = params.upload ?? jest.fn().mockResolvedValue(undefined);
  const port: LogoStoragePort = {
    isAvailable: () => params.available ?? true,
    exists,
    upload,
    remove: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn((path: string) => `https://cdn.example/${path}`),
  };
  return { port, exists, upload };
}

function brandPort(
  params: {
    search?: jest.Mock;
    download?: jest.Mock;
  } = {},
): BrandLogoPort {
  return {
    search: params.search ?? jest.fn().mockResolvedValue([]),
    download:
      params.download ??
      jest
        .fn()
        .mockResolvedValue({ kind: 'ok', buffer: Buffer.from([1, 2, 3]) }),
  };
}

describe('LogoService', () => {
  it('returns null for an invalid domain without calling the network', async () => {
    const download = jest.fn();
    const storage = storagePort();
    const service = new LogoService(storage.port, brandPort({ download }));

    await expect(service.ensureLogo('not a domain')).resolves.toBeNull();
    expect(download).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('does not store a file when the brand returns 404', async () => {
    const download = jest.fn().mockResolvedValue({ kind: 'not_found' });
    const storage = storagePort();
    const service = new LogoService(storage.port, brandPort({ download }));

    await expect(service.ensureLogo('missing.example')).resolves.toBeNull();
    expect(storage.upload).not.toHaveBeenCalled();
    await expect(
      service.ensureLogo('https://missing.example/path'),
    ).resolves.toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('uploads the downloaded brand and returns its path', async () => {
    const storage = storagePort();
    const service = new LogoService(storage.port, brandPort());

    await expect(service.ensureLogo('visa.com')).resolves.toBe(
      'brands/visa.com.png',
    );
    expect(storage.upload).toHaveBeenCalledWith(
      'brands/visa.com.png',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/png' }),
    );
  });

  it('reuses an existing brand file without downloading', async () => {
    const exists = jest.fn().mockResolvedValue(true);
    const download = jest.fn();
    const storage = storagePort({ exists });
    const service = new LogoService(storage.port, brandPort({ download }));

    await expect(service.ensureLogo('visa.com')).resolves.toBe(
      'brands/visa.com.png',
    );
    expect(download).not.toHaveBeenCalled();
  });

  it('prefers a custom logo over the shared brand and the legacy URL', () => {
    const service = new LogoService(storagePort().port, brandPort());

    expect(
      service.resolveUrl({
        customLogoPath: 'custom/user/inst.png',
        logoPath: 'brands/bhd.com.do.png',
        logoUrl: 'https://legacy.example/logo.png',
      }),
    ).toBe('https://cdn.example/custom/user/inst.png');
    expect(
      service.resolveUrl({
        logoPath: 'brands/bhd.com.do.png',
        logoUrl: 'https://legacy.example/logo.png',
      }),
    ).toBe('https://cdn.example/brands/bhd.com.do.png');
    expect(
      service.resolveUrl({ logoUrl: 'https://legacy.example/logo.png' }),
    ).toBe('https://legacy.example/logo.png');
  });

  it('rejects svg uploads and files over 1 MB with 400', async () => {
    const service = new LogoService(storagePort().port, brandPort());
    const svg: LogoUploadFile = {
      mimetype: 'image/svg+xml',
      size: 10,
      buffer: Buffer.from('<svg></svg>'),
    };
    await expect(
      service.saveCustomLogo('user', 'inst', svg),
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: expect.stringMatching(/PNG, JPG o WEBP/),
      },
    });
    const huge: LogoUploadFile = {
      mimetype: 'image/png',
      size: 1_000_001,
      buffer: Buffer.from('x'),
    };
    await expect(
      service.saveCustomLogo('user', 'inst', huge),
    ).rejects.toMatchObject({
      response: { statusCode: 400, message: 'Máximo 1 MB' },
    });
  });

  it('throws 503 when storage is unavailable', async () => {
    const service = new LogoService(
      storagePort({ available: false }).port,
      brandPort(),
    );
    const file: LogoUploadFile = {
      mimetype: 'image/png',
      size: 10,
      buffer: Buffer.from('x'),
    };
    await expect(
      service.saveCustomLogo('user', 'inst', file),
    ).rejects.toMatchObject({
      response: { statusCode: 503, message: 'Storage no está configurado' },
    });
  });

  it('returns no network logo for OTHER', () => {
    const service = new LogoService(storagePort().port, brandPort());
    expect(service.networkLogoUrl('OTHER')).toBeNull();
    expect(service.networkLogoUrl(null)).toBeNull();
  });
});
