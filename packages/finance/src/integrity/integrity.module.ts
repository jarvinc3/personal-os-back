import { Module } from '@nestjs/common';
import { DomainEventsModule } from '@personal-os/core';
import { BalanceIntegrityService } from './application/balance-integrity.service';
import { BalanceIntegrityScheduler } from './infrastructure/balance-integrity.scheduler';
import { IntegrityRepository } from './infrastructure/integrity.repository';
import { IntegrityController } from './presentation/integrity.controller';

@Module({
  imports: [DomainEventsModule],
  controllers: [IntegrityController],
  providers: [
    IntegrityRepository,
    BalanceIntegrityService,
    BalanceIntegrityScheduler,
  ],
  exports: [BalanceIntegrityService, IntegrityRepository],
})
export class FinanceIntegrityModule {}
