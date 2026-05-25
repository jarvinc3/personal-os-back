import { Module, RequestMethod } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { isBullMqEnabled, parseEnv } from './config';
import type { Env } from './config';
import { CoreModule } from './core/core.module';
import { QueueNames } from './core/queues/queue.constants';
import { HealthModule } from './health/health.module';
import { AiModule } from './modules/ai-agent';
import { AuthModule } from './modules/auth/auth.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';
import { FinanceModule } from './modules/finance/finance.module';
import { PrismaModule } from './prisma/prisma.module';

function isBullMqEnabledAtModuleLoad(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const redisEnabled =
    process.env.REDIS_ENABLED === 'true' || process.env.REDIS_ENABLED === '1';

  return isBullMqEnabled({
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    REDIS_URL: process.env.REDIS_URL?.trim() || undefined,
    REDIS_ENABLED: redisEnabled,
  });
}

const bullMqEnabled = isBullMqEnabledAtModuleLoad();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: parseEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level:
            config.get('NODE_ENV', { infer: true }) === 'production'
              ? 'info'
              : 'debug',
          transport:
            config.get('NODE_ENV', { infer: true }) !== 'production'
              ? {
                  target: 'pino-pretty',
                }
              : undefined,
          redact: [
            'req.headers.authorization',
            'req.body.password',
            'req.body.token',
          ],
          genReqId: (req) => {
            const requestIdHeader = req.headers['x-request-id'];
            return (
              (typeof requestIdHeader === 'string' ? requestIdHeader : undefined) ??
              randomUUID()
            );
          },
          customProps: (req) => ({
            userId: (req as { user?: { sub?: string } }).user?.sub,
          }),
        },
        forRoutes: [{ path: '*path', method: RequestMethod.ALL }],
      }),
    }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 5,
      },
      {
        name: 'medium',
        ttl: 10_000,
        limit: 30,
      },
      {
        name: 'long',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    EventEmitterModule.forRoot({
      wildcard: false,
      maxListeners: 20,
    }),
    ...(bullMqEnabled
      ? [
          BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => ({
              connection: {
                url: config.getOrThrow('REDIS_URL', { infer: true }),
              },
              defaultJobOptions: {
                attempts: 3,
                backoff: {
                  type: 'exponential',
                  delay: 1000,
                },
                removeOnComplete: 500,
                removeOnFail: 1000,
              },
            }),
          }),
          BullModule.registerQueue(
            { name: QueueNames.EMAIL_SYNC },
            { name: QueueNames.AI_PROCESSING },
            { name: QueueNames.NOTIFICATIONS },
          ),
        ]
      : []),
    CacheModule.register({
      isGlobal: true,
      ttl: 300_000,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CoreModule,
    HealthModule,
    UsersModule,
    FinanceModule,
    NotificationsModule,
    AiModule,
    AuthModule,
  ],
})
export class AppModule {}
