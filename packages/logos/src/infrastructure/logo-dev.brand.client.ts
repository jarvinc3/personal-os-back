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

function readSearchHit(row: unknown): BrandSearchHit | null {
  if (row === null || row === undefined) {
    throw new Error('Logo.dev search returned an empty row');
  }
  if (typeof row !== 'object') {
    return null;
  }
  const name = 'name' in row && typeof row.name === 'string' ? row.name : '';
  const domain =
    'domain' in row && typeof row.domain === 'string' ? row.domain : '';
  const normalizedDomain = normalizeDomain(domain);
  return name && normalizedDomain ? { name, domain: normalizedDomain } : null;
}

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
      const payload: unknown = await res.json();
      const rows: unknown[] = Array.isArray(payload) ? payload : [];
      return rows
        .map(readSearchHit)
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
