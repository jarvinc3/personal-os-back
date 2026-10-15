import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { MerchantsService } from './application/merchants.service';
import { MerchantsRepository } from './infrastructure/merchants.repository';
import { MerchantsController } from './presentation/merchants.controller';

@Module({
  imports: [FinanceOwnershipModule, LogosModule],
  controllers: [MerchantsController],
  providers: [MerchantsRepository, MerchantsService],
  exports: [MerchantsService, MerchantsRepository],
})
export class FinanceMerchantsModule {}
