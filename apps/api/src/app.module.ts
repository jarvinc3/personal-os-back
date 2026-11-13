import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import {
  Injectable,
  Module,
  OnModuleInit,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  AiModule,
  AiSignalConsumerRegistry,
  EmailProductProposalCatalogRegistry,
  INTELLIGENCE_SETTINGS_DESCRIPTOR,
} from '@personal-os/intelligence';
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
import {
  FINANCE_SETTINGS_DESCRIPTOR,
  FinanceAiCapabilities,
  FinanceEmailProductProposalCatalog,
  FinanceModule,
} from '@personal-os/finance';
import { NotificationsModule } from '@personal-os/notifications';
import { UsersModule } from '@personal-os/users';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './health/health.module';
import { UserDataWipeModule } from './user-data-wipe/user-data-wipe.module';
import { AiCapabilityCompositionService } from './ai-capabilities/ai-capability-composition.service';
import { FinanceSignalConsumer } from '@personal-os/finance';
import { ModuleSettingsModule } from './module-settings/module-settings.module';
import { EmailProductHintsModule } from './email-product-hints/email-product-hints.module';
import { AGENDA_SETTINGS_DESCRIPTOR } from './module-settings/descriptors/agenda.settings-descriptor';
import { HEALTH_SETTINGS_DESCRIPTOR } from './module-settings/descriptors/health.settings-descriptor';
import { PROJECTS_SETTINGS_DESCRIPTOR } from './module-settings/descriptors/projects.settings-descriptor';

@Injectable()
class AiSignalConsumerCompositionService implements OnModuleInit {
  constructor(
    private readonly registry: AiSignalConsumerRegistry,
    private readonly finance: FinanceSignalConsumer,
  ) {}
  onModuleInit(): void {
    this.registry.register(this.finance);
  }
}

@Injectable()
class EmailProductProposalCatalogCompositionService implements OnModuleInit {
  constructor(
    private readonly registry: EmailProductProposalCatalogRegistry,
    private readonly catalog: FinanceEmailProductProposalCatalog,
  ) {}
  onModuleInit(): void {
    this.registry.register(this.catalog);
  }
}
const bullMqEnabled = isBullMqEnabledFromProcessEnv();
const bullBoardEnabled = isBullBoardEnabledFromProcessEnv();
@Module({
  providers: [
    {
      provide: AI_CAPABILITY_PROVIDERS,
      useFactory: (finance: FinanceAiCapabilities) => [finance],
      inject: [FinanceAiCapabilities],
    },
    AiCapabilityCompositionService,
    AiSignalConsumerCompositionService,
    EmailProductProposalCatalogCompositionService,
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
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
    EmailProductHintsModule,
    ModuleSettingsModule.register([
      FINANCE_SETTINGS_DESCRIPTOR,
      INTELLIGENCE_SETTINGS_DESCRIPTOR,
      AGENDA_SETTINGS_DESCRIPTOR,
      PROJECTS_SETTINGS_DESCRIPTOR,
      HEALTH_SETTINGS_DESCRIPTOR,
    ]),
    NotificationsModule,
    AiModule,
    AuthModule,
  ],
})
export class AppModule {}
