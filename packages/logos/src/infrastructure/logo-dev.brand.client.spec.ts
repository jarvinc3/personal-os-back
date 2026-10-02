import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { LogoDevBrandClient } from './logo-dev.brand.client';

function config(
  values: Partial<Record<keyof Env, string | undefined>> = {},
): ConfigService<Env, true> {
  const map: Record<string, string | undefined> = {
    LOGO_DEV_SECRET_KEY: 'sk_test',
    LOGO_DEV_PUBLISHABLE_KEY: 'pk_test',
    ...values,
  };
  return {
    get: (key: string) => map[key],
  } as unknown as ConfigService<Env, true>;
}

describe('LogoDevBrandClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('returns no hits without a secret key', async () => {
    const client = new LogoDevBrandClient(
      config({ LOGO_DEV_SECRET_KEY: undefined }),
    );
    await expect(client.search('visa')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps and normalizes search hits', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { name: 'Visa', domain: 'https://VISA.com/path' },
          { name: '', domain: 'empty.example' },
          { name: 'No domain' },
        ]),
    });
    const client = new LogoDevBrandClient(config());

    await expect(client.search('visa')).resolves.toEqual([
      { name: 'Visa', domain: 'visa.com' },
    ]);
  });

  it('returns unavailable when the publishable key is missing', async () => {
    const client = new LogoDevBrandClient(
      config({ LOGO_DEV_PUBLISHABLE_KEY: undefined }),
    );
    await expect(client.download('visa.com')).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a 404 to not_found', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const client = new LogoDevBrandClient(config());

    await expect(client.download('missing.example')).resolves.toEqual({
      kind: 'not_found',
    });
  });

  it('maps a failed download to unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const client = new LogoDevBrandClient(config());

    await expect(client.download('visa.com')).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('returns the image buffer on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });
    const client = new LogoDevBrandClient(config());

    await expect(client.download('visa.com')).resolves.toEqual({
      kind: 'ok',
      buffer: Buffer.from([1, 2, 3]),
    });
  });
});
