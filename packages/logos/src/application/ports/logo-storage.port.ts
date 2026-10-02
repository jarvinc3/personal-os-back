export const LOGO_STORAGE = 'LOGO_STORAGE' as const;

export type LogoUploadOptions = {
  contentType: string;
  cacheControl: string;
  upsert: boolean;
};

export interface LogoStoragePort {
  isAvailable(): boolean;
  exists(prefix: string, filename: string): Promise<boolean>;
  upload(path: string, body: Buffer, options: LogoUploadOptions): Promise<void>;
  publicUrl(path: string): string | null;
}
