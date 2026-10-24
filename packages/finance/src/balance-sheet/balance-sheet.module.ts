import { Module } from '@nestjs/common';
import { FinanceEntitiesModule } from '../entities/entities.module';
import { FinanceFxModule } from '../fx/fx.module';
import { BalanceSheetService } from './application/balance-sheet.service';
import { BalanceSheetRepository } from './infrastructure/balance-sheet.repository';
import { BalanceSheetController } from './presentation/balance-sheet.controller';

@Module({
  imports: [FinanceFxModule, FinanceEntitiesModule],
  controllers: [BalanceSheetController],
  providers: [BalanceSheetRepository, BalanceSheetService],
  exports: [BalanceSheetService],
})
export class FinanceBalanceSheetModule {}
