import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '@personal-os/auth';
import type { Env } from '@personal-os/config';
import {
  isBullBoardEnabledFromProcessEnv,
  isBullMqEnabledFromProcessEnv,
  parseEnv,
} from '@personal-os/config';
import { CoreModule, getBullBoardImports, QueueNames } from '@personal-os/core';
import { PrismaModule } from '@personal-os/database';
import {
  FINANCE_SETTINGS_DESCRIPTOR,
  FinanceModule,
} from '@personal-os/finance';
import {
  AiModule,
  INTELLIGENCE_SETTINGS_DESCRIPTOR,
} from '@personal-os/intelligence';
import {
  NotificationIntentModule,
  NotificationsModule,
} from '@personal-os/notifications';
import { UsersModule } from '@personal-os/users';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AiCapabilityCompositionService } from './ai-capabilities/ai-capability-composition.service';
import { AI_CAPABILITY_PROVIDERS_DEFINITION } from './ai-capabilities/ai-capability-providers.provider';
import { AiSignalConsumerCompositionService } from './ai-signals/ai-signal-consumer-composition.service';
import { EmailProductHintsModule } from './email-product-hints/email-product-hints.module';
import { EmailProductProposalCatalogCompositionService } from './email-product-proposals/email-product-proposal-catalog-composition.service';
import { HealthModule } from './health/health.module';
import { buildPinoLoggerParams } from './logging/pino-logger-params';
import { AGENDA_SETTINGS_DESCRIPTOR } from './module-settings/descriptors/agenda.settings-descriptor';
import { HEALTH_SETTINGS_DESCRIPTOR } from './module-settings/descriptors/health.settings-descriptor';
import { PROJECTS_SETTINGS_DESCRIPTOR } from './module-settings/descriptors/projects.settings-descriptor';
import { ModuleSettingsModule } from './module-settings/module-settings.module';
import { buildBullMqRootOptions } from './queues/bullmq-options';
import { UserDataWipeModule } from './user-data-wipe/user-data-wipe.module';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();
const bullBoardEnabled = isBullBoardEnabledFromProcessEnv();

@Module({
  providers: [
    AI_CAPABILITY_PROVIDERS_DEFINITION,
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
      useFactory: (config: ConfigService<Env, true>) =>
        buildPinoLoggerParams(config),
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
            useFactory: (config: ConfigService<Env, true>) =>
              buildBullMqRootOptions(config),
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
    NotificationIntentModule,
    AiModule,
    AuthModule,
  ],
})
export class AppModule {}
