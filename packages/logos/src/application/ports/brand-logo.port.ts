export const BRAND_LOGO = 'BRAND_LOGO' as const;

export type BrandSearchHit = { name: string; domain: string };

export type BrandLogoDownload =
  | { kind: 'ok'; buffer: Buffer }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

export interface BrandLogoPort {
  search(query: string): Promise<BrandSearchHit[]>;
  download(domain: string): Promise<BrandLogoDownload>;
}
