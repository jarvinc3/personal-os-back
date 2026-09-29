import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../../config/env.schema';
import { cardNetworkDomain } from '../domain/card-network-domains';
import type { LogoRow } from '../domain/logo-row';
import { normalizeDomain } from '../domain/normalize-domain';

const BUCKET = 'logos';
const BRANDS_PREFIX = 'brands';

export type BrandSearchHit = { name: string; domain: string };

export type LogoUploadFile = {
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type StorageListClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        prefix: string,
        options: { search: string; limit: number },
      ) => Promise<{ data: { name: string }[] | null }>;
      upload: (
        path: string,
        body: Buffer,
        options: {
          contentType: string;
          cacheControl: string;
          upsert: boolean;
        },
      ) => Promise<{ error: { message: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

@Injectable()
export class LogoService {
  private readonly log = new Logger(LogoService.name);
  private readonly supabase: SupabaseClient | null;
  /** Successful paths and confirmed 404s. Transient failures stay uncached. */
  private readonly ensured = new Map<string, string | null>();
  private networksPromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const supabaseUrl = config.get('SUPABASE_URL', { infer: true });
    const serviceRoleKey = config.get('SUPABASE_SERVICE_ROLE_KEY', {
      infer: true,
    });
    this.supabase =
      supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : null;
  }

  async search(query: string): Promise<BrandSearchHit[]> {
    const q = query?.trim();
    const secret = this.config.get('LOGO_DEV_SECRET_KEY', { infer: true });
    if (!q || q.length < 2 || !secret) return [];

    try {
      const res = await fetch(
        `https://api.logo.dev/search?q=${encodeURIComponent(q)}`,
        {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(5000),
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

  /** Ensures brands/{domain}.png exists and returns its storage path. */
  async ensureLogo(rawDomain: string): Promise<string | null> {
    const domain = normalizeDomain(rawDomain);
    if (!domain) return null;
    if (this.ensured.has(domain)) return this.ensured.get(domain) ?? null;

    const filename = `${domain}.png`;
    const path = `${BRANDS_PREFIX}/${filename}`;
    const storage = this.storage();
    if (!storage) return null;

    try {
      const { data: found } = await storage.list(BRANDS_PREFIX, {
        search: filename,
        limit: 5,
      });
      if (found?.some((file) => file.name === filename)) {
        this.ensured.set(domain, path);
        return path;
      }
    } catch (error) {
      this.log.warn(
        `Logo lookup failed for ${domain}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }

    const publishable = this.config.get('LOGO_DEV_PUBLISHABLE_KEY', {
      infer: true,
    });
    if (!publishable) return null;

    let res: Response;
    try {
      const url =
        `https://img.logo.dev/${encodeURIComponent(domain)}` +
        `?token=${encodeURIComponent(publishable)}&size=128&format=png&fallback=404`;
      res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch (error) {
      this.log.warn(
        `Logo.dev download failed for ${domain}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }

    if (res.status === 404) {
      this.ensured.set(domain, null);
      return null;
    }
    if (!res.ok) {
      this.log.warn(`Logo.dev download failed for ${domain}: ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const { error } = await storage.upload(path, buffer, {
      contentType: 'image/png',
      cacheControl: '31536000',
      upsert: false,
    });
    if (error && !/exists|duplicate|already/i.test(error.message)) {
      this.log.error(`Upload failed for ${domain}: ${error.message}`);
      return null;
    }
    this.ensured.set(domain, path);
    return path;
  }

  async ensureCardNetworks(): Promise<void> {
    if (!this.networksPromise) {
      const domains = ['visa.com', 'mastercard.com', 'americanexpress.com', 'discover.com'];
      this.networksPromise = Promise.all(
        domains.map((domain) => this.ensureLogo(domain)),
      )
        .then(() => undefined)
        .catch((error: unknown) => {
          this.networksPromise = null;
          throw error;
        });
    }
    await this.networksPromise;
  }

  async saveCustomLogo(
    userId: string,
    entityId: string,
    file: LogoUploadFile,
  ): Promise<string> {
    const allowed: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    const ext = allowed[file.mimetype];
    if (!ext) {
      throw new Error('Formato no permitido (usa PNG, JPG o WEBP)');
    }
    if (file.size > 1_000_000) {
      throw new Error('Máximo 1 MB');
    }
    const storage = this.storage();
    if (!storage) throw new Error('Storage no está configurado');

    const path = `custom/${userId}/${entityId}.${ext}`;
    const { error } = await storage.upload(path, file.buffer, {
      contentType: file.mimetype,
      cacheControl: '3600',
      upsert: true,
    });
    if (error) throw new Error(error.message);
    return path;
  }

  publicUrl(path?: string | null): string | null {
    if (!path) return null;
    const storage = this.storage();
    if (!storage) return null;
    return storage.getPublicUrl(path).data.publicUrl || null;
  }

  /** custom logo, then shared brand file, then a legacy external URL. */
  resolveUrl(row?: LogoRow | null): string | null {
    if (!row) return null;
    return (
      this.publicUrl(row.customLogoPath) ??
      this.publicUrl(row.logoPath) ??
      row.logoUrl ??
      null
    );
  }

  /** Sync read. Call ensureCardNetworks first so a hit is cached. */
  networkLogoUrl(network: string | null | undefined): string | null {
    const domain = cardNetworkDomain(network);
    if (!domain || !this.ensured.has(domain)) return null;
    return this.publicUrl(this.ensured.get(domain));
  }

  private storage(): ReturnType<StorageListClient['storage']['from']> | null {
    if (!this.supabase) return null;
    return (this.supabase as unknown as StorageListClient).storage.from(BUCKET);
  }
}
