import { Module } from '@nestjs/common';
import { FinanceFxModule } from '../fx/fx.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceMerchantsModule } from '../merchants/merchants.module';
import { FinanceSignalConsumer } from './finance-signal-consumer';
import { CardPaymentPlanner } from './signal-card-payment-planner';
import { SignalCardPaymentApplier } from './signal-card-payment-applier';
import { CardPaymentTargets } from './signal-card-payment-targets';
import { SignalImportApplier } from './signal-import-applier';
import { SignalImportExecutor } from './signal-import-executor';
import { SignalImportFollowUps } from './signal-import-follow-ups';
import { SignalImportMovementWriter } from './signal-import-movement-writer';
import { SignalImportPlanGuard } from './signal-import-plan-guard';
import { SignalImportPlanner } from './signal-import-planner';
import { SignalImportPreviewReader } from './signal-import-preview';
import { SignalImportPreviewer } from './signal-import-previewer';
import { SignalImportReviewReasons } from './signal-import-review-reasons';
import { SignalImportRunLock } from './signal-import-run-lock';
import { SignalImportRunner } from './signal-import-runner';
import { SignalImportStore } from './signal-import-store';
import { SignalImportTargets } from './signal-import-targets';
import { SignalMovementCategory } from './signal-movement-category';
import { SignalMovementDuplicate } from './signal-movement-duplicate';
import { SignalMovementPlanner } from './signal-movement-planner';
import { SignalPlanDispatch } from './signal-plan-dispatch';
import { SignalReversalPlanner } from './signal-reversal-planner';
import { PendingReversalRetry } from './signal-reversal-retry';
import { SignalReversalRetryApply } from './signal-reversal-retry-apply';
import { SignalReversalRetryWriter } from './signal-reversal-retry-writer';
import { ReversalTargetResolver } from './signal-reversal-target';
import { TransferPairing } from './signal-transfer-pairing';

@Module({
  imports: [FinanceLedgerModule, FinanceMerchantsModule, FinanceFxModule],
  providers: [
    SignalImportStore,
    SignalImportTargets,
    CardPaymentTargets,
    ReversalTargetResolver,
    SignalReversalPlanner,
    SignalMovementCategory,
    SignalMovementDuplicate,
    SignalMovementPlanner,
    CardPaymentPlanner,
    SignalCardPaymentApplier,
    SignalImportPlanGuard,
    SignalPlanDispatch,
    SignalImportPlanner,
    SignalImportMovementWriter,
    SignalImportApplier,
    SignalImportReviewReasons,
    SignalImportPreviewReader,
    TransferPairing,
    PendingReversalRetry,
    SignalReversalRetryApply,
    SignalReversalRetryWriter,
    SignalImportFollowUps,
    SignalImportExecutor,
    SignalImportRunLock,
    SignalImportRunner,
    SignalImportPreviewer,
    FinanceSignalConsumer,
  ],
  exports: [FinanceSignalConsumer],
})
export class FinanceSignalsModule {}
