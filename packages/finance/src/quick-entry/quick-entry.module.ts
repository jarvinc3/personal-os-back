import { Module } from '@nestjs/common';
import { FinanceCatalogModule } from '../catalog/catalog.module';
import { FinanceFxModule } from '../fx/fx.module';
import { QUICK_ENTRY_EXTRACTOR } from '../shared/application/tokens';
import { QuickEntryContextService } from './application/quick-entry-context';
import { QuickEntryService } from './application/quick-entry.service';
import { AiQuickEntryExtractor } from './infrastructure/ai-quick-entry.extractor';
import { QuickEntryController } from './presentation/quick-entry.controller';

@Module({
  imports: [FinanceCatalogModule, FinanceFxModule],
  controllers: [QuickEntryController],
  providers: [
    QuickEntryContextService,
    QuickEntryService,
    AiQuickEntryExtractor,
    {
      provide: QUICK_ENTRY_EXTRACTOR,
      useExisting: AiQuickEntryExtractor,
    },
  ],
  exports: [QuickEntryService],
})
export class FinanceQuickEntryModule {}
