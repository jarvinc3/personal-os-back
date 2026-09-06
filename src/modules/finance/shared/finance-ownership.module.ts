import { Module } from '@nestjs/common';
import { FinanceOwnershipService } from './application/finance-ownership.service';

@Module({
  providers: [FinanceOwnershipService],
  exports: [FinanceOwnershipService],
})
export class FinanceOwnershipModule {}
