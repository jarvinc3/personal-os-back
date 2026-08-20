import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from './config';
import {
  isBullBoardEnabledFromProcessEnv,
  isBullMqEnabledFromProcessEnv,
  parseEnv,
} from './config';
import { CoreModule } from './core/core.module';
import { getBullBoardImports } from './core/queues/bull-board.imports';
import { QueueNames } from './core/queues/queue.constants';
import { HealthModule } from './health/health.module';
import { AiModule } from './modules/ai-agent';
import { AuthModule } from './modules/auth';
import { FinanceModule } from './modules/finance';
import { NotificationsModule } from './modules/notifications';
import { UsersModule } from './modules/users';
import { PrismaModule } from './prisma/prisma.module';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();
const bullBoardEnabled = isBullBoardEnabledFromProcessEnv();

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
            { name: QueueNames.GMAIL_SYNC },
            { name: QueueNames.AI_PROCESSING },
            { name: QueueNames.NOTIFICATIONS },
          ),
        ]
      : []),
    ...(bullBoardEnabled ? getBullBoardImports() : []),
    CacheModule.register({
      isGlobal: true,
      ttl: 300_000,
    }),
    // Reserved for future cron jobs (no @Cron handlers yet).
    // Reserved for future cron jobs (no @Cron handlers yet).

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
