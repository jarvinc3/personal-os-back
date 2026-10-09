import { Module } from '@nestjs/common';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { CardStatementsService } from './application/card-statements.service';
import { CardStatementsRepository } from './infrastructure/card-statements.repository';
import { CardStatementsScheduler } from './infrastructure/card-statements.scheduler';
import { CardStatementsController } from './presentation/card-statements.controller';

@Module({
  imports: [FinanceOwnershipModule],
  controllers: [CardStatementsController],
  providers: [
    CardStatementsRepository,
    CardStatementsService,
    CardStatementsScheduler,
  ],
  exports: [CardStatementsService],
})
export class FinanceStatementsModule {}
