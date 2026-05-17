import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolConfig } from 'pg';
import type { Env } from '../config/env.schema';
import { getPrismaClientClass } from './generated/internal/class';

const PrismaClient = getPrismaClientClass();

/**
 * Supabase / cloud Postgres URLs use TLS. The `pg` driver also reads
 * `sslmode` from the URL; combined with Node 22+ / pg-connection-string,
 * `require` can still verify the full chain and fail on pooler intermediates.
 * We enable TLS explicitly via `Pool.ssl` and drop `sslmode` from the URL so
 * `rejectUnauthorized` from env is respected.
 */
function isLikelySupabasePostgresUrl(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  return (
    lower.includes('.pooler.supabase.com') || lower.includes('.supabase.co')
  );
}

function postgresUrlUsesTls(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  const sslmodeRaw = lower.match(/[?&]sslmode=([^&]+)/)?.[1];
  const sslmode = sslmodeRaw?.replace(/\+/g, ' ');
  if (sslmode === 'disable' || sslmode === 'false') return false;
  if (sslmode) return true;
  return isLikelySupabasePostgresUrl(connectionString);
}

function poolConfigForPostgresUrl(
  connectionString: string,
  rejectUnauthorized: boolean,
): PoolConfig {
  if (!postgresUrlUsesTls(connectionString)) {
    return { connectionString };
  }

  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized },
    };
  } catch {
    return {
      connectionString,
      ssl: { rejectUnauthorized },
    };
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService<Env, true>) {
    const connectionString = configService.getOrThrow('DATABASE_URL', {
      infer: true,
    });
    const nodeEnv = configService.get('NODE_ENV', { infer: true });
    const explicit = configService.get<boolean>(
      'DATABASE_SSL_REJECT_UNAUTHORIZED',
      {
        infer: true,
      },
    );
    /** Supabase pooler TLS chains often fail strict Node verification in prod; opt into strict via env for other hosts. */
    const rejectUnauthorized =
      explicit !== undefined
        ? explicit
        : nodeEnv === 'production' &&
          !isLikelySupabasePostgresUrl(connectionString);

    const pool = new Pool(
      poolConfigForPostgresUrl(connectionString, Boolean(rejectUnauthorized)),
    );
    super({ adapter: new PrismaPg(pool) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
