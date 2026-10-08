import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '@personal-os/config';
import type {
  LogoStoragePort,
  LogoUploadOptions,
} from '../application/ports/logo-storage.port';

const BUCKET = 'logos';
const ALREADY_EXISTS_PATTERN = /exists|duplicate|already/i;

@Injectable()
export class SupabaseLogoStorage implements LogoStoragePort {
  private readonly supabase: SupabaseClient | null;

  constructor(config: ConfigService<Env, true>) {
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

  isAvailable(): boolean {
    return this.supabase !== null;
  }

  async exists(prefix: string, filename: string): Promise<boolean> {
    if (!this.supabase) {
      return false;
    }
    const { data } = await this.bucket().list(prefix, {
      search: filename,
      limit: 5,
    });
    return Boolean(data?.some((file) => file.name === filename));
  }

  async upload(
    path: string,
    body: Buffer,
    options: LogoUploadOptions,
  ): Promise<void> {
    if (!this.supabase) {
      throw new Error('Storage no está configurado');
    }
    const { error } = await this.bucket().upload(path, body, options);
    if (error && !ALREADY_EXISTS_PATTERN.test(error.message)) {
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  publicUrl(path: string): string | null {
    if (!this.supabase) {
      return null;
    }
    return this.bucket().getPublicUrl(path).data.publicUrl || null;
  }

  async remove(path: string): Promise<void> {
    if (!this.supabase) {
      return;
    }
    const { error } = await this.bucket().remove([path]);
    if (error) {
      throw new Error(`Remove failed: ${error.message}`);
    }
  }

  private bucket() {
    if (!this.supabase) {
      throw new Error('Storage no está configurado');
    }
    return this.supabase.storage.from(BUCKET);
  }
}
