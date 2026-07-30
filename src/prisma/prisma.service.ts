import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { Env } from '../config/env.schema';
import { getPrismaClientClass } from './generated/internal/class';
import {
    defaultRejectUnauthorized,
    poolConfigForPostgresUrl,
} from './pg-pool.config';

const PrismaClient = getPrismaClientClass();

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
    const explicit = configService.get('DATABASE_SSL_REJECT_UNAUTHORIZED', {
      infer: true,
    });
    /** Supabase pooler TLS chains often fail strict Node verification in prod; opt into strict via env for other hosts. */
    const rejectUnauthorized = defaultRejectUnauthorized(
      connectionString,
      nodeEnv,
      explicit,
    );

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
