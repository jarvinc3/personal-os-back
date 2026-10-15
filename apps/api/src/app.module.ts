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
import type { Env } from '@personal-os/config';
import {
  bullmqRedisConnection,
  isBullBoardEnabledFromProcessEnv,
  isBullMqEnabledFromProcessEnv,
  parseEnv,
} from '@personal-os/config';
import { CoreModule } from '@personal-os/core';
import { getBullBoardImports } from '@personal-os/core';
import { QueueNames } from '@personal-os/core';
import { HealthModule } from './health/health.module';
import { UserDataWipeModule } from './user-data-wipe/user-data-wipe.module';
import { AiModule } from '@personal-os/ai-agent';
import { AuthModule } from '@personal-os/auth';
import { FinanceModule } from '@personal-os/finance';
import { NotificationsModule } from '@personal-os/notifications';
import { UsersModule } from '@personal-os/users';
import { PrismaModule } from '@personal-os/database';

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
            config.get('NODE_ENV', { infer: true }) === 'development'
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
              (typeof requestIdHeader === 'string'
                ? requestIdHeader
                : undefined) ?? randomUUID()
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
              connection: bullmqRedisConnection(
                config.getOrThrow('REDIS_URL', { infer: true }),
              ),
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
    // Feature modules register their own @Cron handlers.
    ScheduleModule.forRoot(),
    PrismaModule,
    CoreModule,
    HealthModule,
    UsersModule,
    UserDataWipeModule,
    FinanceModule,
    NotificationsModule,
    AiModule,
    AuthModule,
  ],
})
export class AppModule {}
