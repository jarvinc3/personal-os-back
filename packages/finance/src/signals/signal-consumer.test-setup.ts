import type { PrismaService } from '@personal-os/database';
import type { ResolveUserBaseCurrencyUseCase } from '../fx/application/resolve-user-base-currency';
import type { ImportCardPaymentUseCase } from '../ledger/application/import-card-payment.use-case';
import type { ImportFinancialTransactionUseCase } from '../ledger/application/import-financial-transaction.use-case';
import type { LedgerQueryService } from '../ledger/application/ledger-query.service';
import type { ReverseTransactionUseCase } from '../ledger/application/reverse-transaction.use-case';
import type { MerchantsService } from '../merchants/application/merchants.service';
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

type SignalConsumerDoubles = {
  prisma: unknown;
  importTransaction: unknown;
  ledger: unknown;
  reverseTransaction: unknown;
  cardPaymentImport: unknown;
  merchants: unknown;
  baseCurrency: unknown;
};

/**
 * Wires the same graph the signals module declares, from the doubles each spec
 * already builds. The service constructors are framework calls, so the test
 * sets them up once here instead of in every file.
 */
export function createFinanceSignalConsumer(
  doubles: SignalConsumerDoubles,
): FinanceSignalConsumer {
  const prisma = doubles.prisma as PrismaService;
  const ledger = doubles.ledger as LedgerQueryService;
  const importTransaction =
    doubles.importTransaction as ImportFinancialTransactionUseCase;
  const store = new SignalImportStore(prisma);
  const targets = new SignalImportTargets(prisma);
  const cardTargets = new CardPaymentTargets(prisma);
  const reversalTargets = new ReversalTargetResolver(prisma, ledger);
  const reversalPlanner = new SignalReversalPlanner(ledger, reversalTargets);
  const movementCategory = new SignalMovementCategory(
    prisma,
    doubles.merchants as MerchantsService,
    ledger,
  );
  const movementDuplicate = new SignalMovementDuplicate(targets, ledger);
  const movementPlanner = new SignalMovementPlanner(
    targets,
    movementDuplicate,
    movementCategory,
  );
  const cardPaymentPlanner = new CardPaymentPlanner(
    doubles.cardPaymentImport as ImportCardPaymentUseCase,
    cardTargets,
  );
  const cardPaymentApplier = new SignalCardPaymentApplier(
    doubles.cardPaymentImport as ImportCardPaymentUseCase,
    store,
  );
  const planGuard = new SignalImportPlanGuard(store, ledger);
  const planDispatch = new SignalPlanDispatch(
    movementPlanner,
    reversalPlanner,
    cardPaymentPlanner,
  );
  const planner = new SignalImportPlanner(planGuard, targets, planDispatch);
  const movementWriter = new SignalImportMovementWriter(
    store,
    importTransaction,
    ledger,
  );
  const applier = new SignalImportApplier(
    store,
    doubles.reverseTransaction as ReverseTransactionUseCase,
    cardPaymentApplier,
  );
  const reviewReasons = new SignalImportReviewReasons(
    targets,
    cardTargets,
    reversalPlanner,
  );
  const previewReader = new SignalImportPreviewReader(reviewReasons);
  const pairing = new TransferPairing(
    prisma,
    importTransaction,
    doubles.baseCurrency as ResolveUserBaseCurrencyUseCase,
  );
  const retryWriter = new SignalReversalRetryWriter(movementWriter, applier);
  const retryApply = new SignalReversalRetryApply(
    store,
    reversalPlanner,
    retryWriter,
  );
  const retry = new PendingReversalRetry(store, prisma, retryApply);
  const followUps = new SignalImportFollowUps(retry, pairing);
  const executor = new SignalImportExecutor(movementWriter, applier, followUps);
  const lock = new SignalImportRunLock(prisma, store);
  const runner = new SignalImportRunner(lock, planner, executor);
  const previewer = new SignalImportPreviewer(planner, previewReader);
  return new FinanceSignalConsumer(previewer, runner);
}
