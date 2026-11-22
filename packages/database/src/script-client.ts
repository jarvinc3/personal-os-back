import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { PrismaClient as PrismaClientInstance } from './generated/client';
import { getPrismaClientClass } from './generated/internal/class';
import {
  defaultRejectUnauthorized,
  poolConfigForPostgresUrl,
} from './pg-pool.config';

/**
 * Standalone client for one-off scripts. Mirrors `PrismaService`: reads
 * `DATABASE_URL` and applies the same TLS defaults, without a Nest context.
 */
export function createScriptPrismaClient(): PrismaClientInstance {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run this script');
  }
  const pool = new Pool(
    poolConfigForPostgresUrl(connectionString, {
      rejectUnauthorized: defaultRejectUnauthorized(
        process.env.NODE_ENV,
        parseBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED),
      ),
      ca: process.env.DATABASE_SSL_CA,
    }),
  );
  const PrismaClient = getPrismaClientClass();
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return value.trim().toLowerCase() === 'true';
}
