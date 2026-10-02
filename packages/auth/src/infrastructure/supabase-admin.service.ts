import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '@personal-os/config';

export type DeleteAuthUserResult =
  | { ok: true; alreadyMissing?: boolean }
  | { ok: false; message: string; retryable: boolean };

@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private readonly client: SupabaseClient | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const nodeEnv = config.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'test') {
      this.client = null;
      return;
    }

    const supabaseUrl = config.getOrThrow('SUPABASE_URL', { infer: true });
    const serviceRoleKey = config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY', {
      infer: true,
    });

    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /**
   * Deletes a Supabase Auth user. "Not found" is treated as success (idempotent).
   * Prefer {@link tryDeleteAuthUser} for durable delete flows that must not throw
   * on retryable provider errors.
   */
  async deleteAuthUser(userId: string): Promise<void> {
    const result = await this.tryDeleteAuthUser(userId);
    if (!result.ok) {
      this.logger.error(
        `Failed to delete Supabase auth user ${userId}: ${result.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo completar la eliminación de la cuenta de autenticación.',
      );
    }
  }

  async tryDeleteAuthUser(userId: string): Promise<DeleteAuthUserResult> {
    if (!this.client) {
      return { ok: true };
    }

    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (!error) {
      return { ok: true };
    }

    if (this.isUserMissingError(error.message, error.status)) {
      return { ok: true, alreadyMissing: true };
    }

    return {
      ok: false,
      message: error.message,
      retryable: this.isRetryableError(error.status),
    };
  }

  private isUserMissingError(message: string, status?: number): boolean {
    if (status === 404) {
      return true;
    }
    const lower = message.toLowerCase();
    return (
      lower.includes('user not found') ||
      lower.includes('not found') ||
      lower.includes('no user found')
    );
  }

  private isRetryableError(status?: number): boolean {
    if (status === undefined) {
      return true;
    }
    return status === 429 || status >= 500;
  }
}
