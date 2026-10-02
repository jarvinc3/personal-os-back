import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type {
  BrandLogoDownload,
  BrandLogoPort,
  BrandSearchHit,
} from '../application/ports/brand-logo.port';
import { normalizeDomain } from '../domain/normalize-domain';

const SEARCH_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 5000;

@Injectable()
export class LogoDevBrandClient implements BrandLogoPort {
  private readonly log = new Logger(LogoDevBrandClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async search(query: string): Promise<BrandSearchHit[]> {
    const secret = this.config.get('LOGO_DEV_SECRET_KEY', { infer: true });
    if (!secret) {
      return [];
    }
    try {
      const res = await fetch(
        `https://api.logo.dev/search?q=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.log.warn(`Logo.dev search failed: ${res.status}`);
        return [];
      }
      const payload = (await res.json()) as unknown;
      const rows = Array.isArray(payload) ? payload : [];
      return rows
        .map((row) => {
          const record = row as { name?: unknown; domain?: unknown };
          const name = typeof record.name === 'string' ? record.name : '';
          const domain = normalizeDomain(
            typeof record.domain === 'string' ? record.domain : '',
          );
          return name && domain ? { name, domain } : null;
        })
        .filter((row): row is BrandSearchHit => row !== null);
    } catch (error) {
      this.log.warn(
        `Logo.dev search error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return [];
    }
  }

  async download(domain: string): Promise<BrandLogoDownload> {
    const publishable = this.config.get('LOGO_DEV_PUBLISHABLE_KEY', {
      infer: true,
    });
    if (!publishable) {
      return { kind: 'unavailable' };
    }
    try {
      const url =
        `https://img.logo.dev/${encodeURIComponent(domain)}` +
        `?token=${encodeURIComponent(publishable)}&size=128&format=png&fallback=404`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (res.status === 404) {
        return { kind: 'not_found' };
      }
      if (!res.ok) {
        this.log.warn(`Logo.dev download failed for ${domain}: ${res.status}`);
        return { kind: 'unavailable' };
      }
      return { kind: 'ok', buffer: Buffer.from(await res.arrayBuffer()) };
    } catch (error) {
      this.log.warn(
        `Logo.dev download failed for ${domain}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { kind: 'unavailable' };
    }
  }
}
