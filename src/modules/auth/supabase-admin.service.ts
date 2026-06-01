import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../config/env.schema';

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

  async deleteAuthUser(userId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (error) {
      this.logger.error(`Failed to delete Supabase auth user ${userId}: ${error.message}`);
      throw new InternalServerErrorException(
        'No se pudo completar la eliminación de la cuenta de autenticación.',
      );
    }
  }
}
