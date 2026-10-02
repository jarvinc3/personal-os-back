import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  BRAND_LOGO,
  type BrandLogoPort,
  type BrandSearchHit,
} from './ports/brand-logo.port';
import { LOGO_STORAGE, type LogoStoragePort } from './ports/logo-storage.port';
import { cardNetworkDomain } from '../domain/card-network-domains';
import type { LogoRow } from '../domain/logo-row';
import { normalizeDomain } from '../domain/normalize-domain';

const BRANDS_PREFIX = 'brands';
const MAX_CUSTOM_LOGO_BYTES = 1_000_000;
const ALLOWED_CUSTOM_LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type { BrandSearchHit } from './ports/brand-logo.port';

export type LogoUploadFile = {
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class LogoService implements OnApplicationBootstrap {
  private readonly log = new Logger(LogoService.name);
  /** Successful paths and confirmed 404s. Transient failures stay uncached. */
  private readonly ensured = new Map<string, string | null>();
  private networksPromise: Promise<void> | null = null;

  constructor(
    @Inject(LOGO_STORAGE)
    private readonly storage: LogoStoragePort,
    @Inject(BRAND_LOGO)
    private readonly brand: BrandLogoPort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureCardNetworks();
    } catch (error) {
      this.log.warn(
        `Card network warm-up failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async search(query: string): Promise<BrandSearchHit[]> {
    const q = query?.trim();
    if (!q || q.length < 2) {
      return [];
    }
    return this.brand.search(q);
  }

  /** Ensures brands/{domain}.png exists and returns its storage path. */
  async ensureLogo(rawDomain: string): Promise<string | null> {
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      return null;
    }
    if (this.ensured.has(domain)) {
      return this.ensured.get(domain) ?? null;
    }
    if (!this.storage.isAvailable()) {
      return null;
    }

    const filename = `${domain}.png`;
    const path = `${BRANDS_PREFIX}/${filename}`;

    try {
      if (await this.storage.exists(BRANDS_PREFIX, filename)) {
        this.ensured.set(domain, path);
        return path;
      }
    } catch (error) {
      this.log.warn(
        `Logo lookup failed for ${domain}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }

    const download = await this.brand.download(domain);
    if (download.kind === 'not_found') {
      this.ensured.set(domain, null);
      return null;
    }
    if (download.kind === 'unavailable') {
      return null;
    }

    try {
      await this.storage.upload(path, download.buffer, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: false,
      });
    } catch (error) {
      this.log.error(
        `Upload failed for ${domain}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
    this.ensured.set(domain, path);
    return path;
  }

  async ensureCardNetworks(): Promise<void> {
    if (!this.networksPromise) {
      const domains = [
        'visa.com',
        'mastercard.com',
        'americanexpress.com',
        'discover.com',
      ];
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
    const ext = ALLOWED_CUSTOM_LOGO_TYPES[file.mimetype];
    if (!ext) {
      throw new Error('Formato no permitido (usa PNG, JPG o WEBP)');
    }
    if (file.size > MAX_CUSTOM_LOGO_BYTES) {
      throw new Error('Máximo 1 MB');
    }
    if (!this.storage.isAvailable()) {
      throw new Error('Storage no está configurado');
    }

    const path = `custom/${userId}/${entityId}.${ext}`;
    await this.storage.upload(path, file.buffer, {
      contentType: file.mimetype,
      cacheControl: '3600',
      upsert: true,
    });
    return path;
  }

  publicUrl(path?: string | null): string | null {
    if (!path) {
      return null;
    }
    return this.storage.publicUrl(path);
  }

  /** custom logo, then shared brand file, then a legacy external URL. */
  resolveUrl(row?: LogoRow | null): string | null {
    if (!row) {
      return null;
    }
    return (
      this.publicUrl(row.customLogoPath) ??
      this.publicUrl(row.logoPath) ??
      row.logoUrl ??
      null
    );
  }

  /** Sync read. Card networks are warmed at bootstrap so a hit is cached. */
  networkLogoUrl(network: string | null | undefined): string | null {
    const domain = cardNetworkDomain(network);
    if (!domain || !this.ensured.has(domain)) {
      return null;
    }
    return this.publicUrl(this.ensured.get(domain));
  }
}
