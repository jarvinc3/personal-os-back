import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  Reflector,
} from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { CustomThrottlerGuard } from './guards/custom-throttler.guard';
import { EnabledModuleGuard } from './guards/enabled-module.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { IdempotencyKeyRetentionScheduler } from './maintenance/idempotency-key-retention.scheduler';
import { PaginationService } from './pagination/pagination.service';
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'supabase-jwt' })],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: EnabledModuleGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) =>
        new ClassSerializerInterceptor(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    PaginationService,
    IdempotencyKeyRetentionScheduler,
  ],
  exports: [PassportModule, PaginationService],
})
export class CoreModule {}
