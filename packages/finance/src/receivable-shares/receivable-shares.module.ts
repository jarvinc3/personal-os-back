import { Module } from '@nestjs/common';
import { PublicReceivableSharesService } from './application/public-receivable-shares.service';
import { ReceivableSharesService } from './application/receivable-shares.service';
import { ReceivableSharesRepository } from './infrastructure/receivable-shares.repository';
import { PublicReceivableSharesController } from './presentation/public-receivable-shares.controller';
import { ReceivableSharesController } from './presentation/receivable-shares.controller';

@Module({
  controllers: [ReceivableSharesController, PublicReceivableSharesController],
  providers: [
    ReceivableSharesRepository,
    ReceivableSharesService,
    PublicReceivableSharesService,
  ],
})
export class FinanceReceivableSharesModule {}
