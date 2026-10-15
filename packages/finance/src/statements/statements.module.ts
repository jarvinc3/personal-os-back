import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { isBullMqEnabledFromProcessEnv } from '@personal-os/config';
import { QueueNames } from '@personal-os/core';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { STATEMENT_EXTRACTOR } from './application/ports/statement-extractor.port';
import {
  STATEMENT_PDF_LOADER,
  STATEMENT_PDF_TEXT,
} from './application/ports/statement-pdf.port';
import { ProcessStatementImportUseCase } from './application/process-statement-import.use-case';
import { StatementImportsService } from './application/statement-imports.service';
import { CardPaymentRemindersService } from './application/card-payment-reminders.service';
import { CardStatementsService } from './application/card-statements.service';
import { AiStatementExtractor } from './infrastructure/ai-statement.extractor';
import { CardStatementsRepository } from './infrastructure/card-statements.repository';
import { CardPaymentRemindersScheduler } from './infrastructure/card-payment-reminders.scheduler';
import { CardStatementsScheduler } from './infrastructure/card-statements.scheduler';
import {
  PdfjsStatementTextExtractor,
  loadPdfjsStatementModule,
} from './infrastructure/pdfjs-statement-text.extractor';
import { StatementImportProcessor } from './infrastructure/statement-import.processor';
import { StatementImportsRepository } from './infrastructure/statement-imports.repository';
import {
  STATEMENT_UPLOAD_STORE,
  TempFileStatementUploadStore,
} from './infrastructure/temp-file-statement-upload.store';
import { CardStatementsController } from './presentation/card-statements.controller';
import { StatementImportsController } from './presentation/statement-imports.controller';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();

@Module({
  imports: [
    FinanceOwnershipModule,
    FinanceLedgerModule,
    FinanceEventsModule,
    ...(bullMqEnabled
      ? [BullModule.registerQueue({ name: QueueNames.STATEMENT_IMPORT })]
      : []),
  ],
  controllers: [CardStatementsController, StatementImportsController],
  providers: [
    CardStatementsRepository,
    CardStatementsService,
    CardStatementsScheduler,
    CardPaymentRemindersService,
    CardPaymentRemindersScheduler,
    StatementImportsRepository,
    StatementImportsService,
    ProcessStatementImportUseCase,
    { provide: STATEMENT_PDF_TEXT, useClass: PdfjsStatementTextExtractor },
    {
      provide: STATEMENT_PDF_LOADER,
      useValue: loadPdfjsStatementModule,
    },
    { provide: STATEMENT_EXTRACTOR, useClass: AiStatementExtractor },
    {
      provide: STATEMENT_UPLOAD_STORE,
      useClass: TempFileStatementUploadStore,
    },
    StatementImportProcessor,
  ],
  exports: [CardStatementsService],
})
export class FinanceStatementsModule {}
