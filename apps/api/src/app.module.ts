import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from '@personal-os/ai-agent';
import { AI_CAPABILITY_PROVIDERS } from '@personal-os/contracts';
import { AuthModule } from '@personal-os/auth';
import type { Env } from '@personal-os/config';
import {
  bullmqRedisConnection,
  isBullBoardEnabledFromProcessEnv,
  isBullMqEnabledFromProcessEnv,
  parseEnv,
} from '@personal-os/config';
import { CoreModule, getBullBoardImports, QueueNames } from '@personal-os/core';
import { PrismaModule } from '@personal-os/database';
import { FinanceModule } from '@personal-os/finance';
import { NotificationsModule } from '@personal-os/notifications';
import { UsersModule } from '@personal-os/users';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './health/health.module';
import { UserDataWipeModule } from './user-data-wipe/user-data-wipe.module';
import { AiCapabilityCompositionService } from './ai-capabilities/ai-capability-composition.service';
const bullMqEnabled = isBullMqEnabledFromProcessEnv();
const bullBoardEnabled = isBullBoardEnabledFromProcessEnv();
@Module({
  providers: [
    { provide: AI_CAPABILITY_PROVIDERS, useValue: [] },
    AiCapabilityCompositionService,
  ],
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
                  options: {
                    colorize: true,
                    levelFirst: true,
                    singleLine: true,
                    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                    ignore: 'pid,hostname,req,res,userId',
                    messageFormat:
                      '{msg}{if context} [{context}]{end}{if method} | {method} {path} | {statusCode} | {responseTime}ms | requestId={requestId}{end}',
                  },
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
            userId: (
              req as {
                user?: {
                  sub?: string;
                };
              }
            ).user?.sub,
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
        ttl: 10000,
        limit: 30,
      },
      {
        name: 'long',
        ttl: 60000,
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
            { name: QueueNames.NOTIFICATIONS },
          ),
        ]
      : []),
    ...(bullBoardEnabled ? getBullBoardImports() : []),
    CacheModule.register({
      isGlobal: true,
      ttl: 300000,
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
