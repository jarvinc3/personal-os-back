import { Module } from '@nestjs/common';
import { FinanceFxModule } from '../fx/fx.module';
import { DeletionJournalModule } from '../shared/deletion-journal.module';
import { ReconciliationsService } from './application/reconciliations.service';
import { ReconciliationsRepository } from './infrastructure/reconciliations.repository';
import { BankChargesController } from './presentation/bank-charges.controller';
import { ReconciliationsController } from './presentation/reconciliations.controller';

@Module({
  imports: [FinanceFxModule, DeletionJournalModule],
  controllers: [ReconciliationsController, BankChargesController],
  providers: [ReconciliationsRepository, ReconciliationsService],
  exports: [ReconciliationsService, ReconciliationsRepository],
})
export class FinanceReconciliationModule {}
