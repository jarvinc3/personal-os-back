import { Injectable } from '@nestjs/common';
import type { RoutedSignal, SignalImportPreview } from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import type { FinanceSignalConsumerPort } from '../contracts';
import { ResolveUserBaseCurrencyUseCase } from '../fx/application/resolve-user-base-currency';
import { ImportCardPaymentUseCase } from '../ledger/application/import-card-payment.use-case';
import { ImportFinancialTransactionUseCase } from '../ledger/application/import-financial-transaction.use-case';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from '../ledger/application/reverse-transaction.use-case';
import { isTransferMovementClass } from '../ledger/domain/movement-class';
import { MerchantsService } from '../merchants/application/merchants.service';
import { CardPaymentPlanner } from './signal-card-payment-planner';
import { CardPaymentTargets } from './signal-card-payment-targets';
import { SignalImportApplier } from './signal-import-applier';
import {
  buildConsumeResult,
  type ImportDraft,
  type ImportPlan,
  type ImportResolutionOverride,
  type SignalConsumeResult,
} from './signal-import-plan';
import { SignalImportPlanner } from './signal-import-planner';
import { parseSignalPayload } from './signal-import-payload';
import { SignalImportPreviewReader } from './signal-import-preview';
import { SignalImportStore } from './signal-import-store';
import { SignalImportTargets } from './signal-import-targets';
import {
  lockSignalImports,
  SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
  SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
} from './signal-import-lock';
import { SignalMovementPlanner } from './signal-movement-planner';
import { PendingReversalRetry } from './signal-reversal-retry';
import { ReversalTargetResolver } from './signal-reversal-target';
import { SignalReversalPlanner } from './signal-reversal-planner';
import { TransferPairing } from './signal-transfer-pairing';

export type { ImportResolutionOverride } from './signal-import-plan';

type ImportResolution = {
  signal: RoutedSignal;
  override: ImportResolutionOverride;
};

@Injectable()
export class FinanceSignalConsumer implements FinanceSignalConsumerPort {
  readonly domain = 'FINANCE';
  private readonly store: SignalImportStore;
  private readonly targets: SignalImportTargets;
  private readonly cardPaymentTargets: CardPaymentTargets;
  private readonly cardPaymentPlanner: CardPaymentPlanner;
  private readonly reversalPlanner: SignalReversalPlanner;
  private readonly planner: SignalImportPlanner;
  private readonly applier: SignalImportApplier;
  private readonly previewReader: SignalImportPreviewReader;
  private readonly reversalRetry: PendingReversalRetry;
  private readonly pairing: TransferPairing;

  constructor(
    private readonly prisma: PrismaService,
    importTransaction: ImportFinancialTransactionUseCase,
    ledger: LedgerQueryService,
    reverseTransaction: ReverseTransactionUseCase,
    cardPaymentImport: ImportCardPaymentUseCase,
    merchants: MerchantsService,
    baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {
    this.store = new SignalImportStore(prisma);
    this.targets = new SignalImportTargets(prisma);
    this.cardPaymentTargets = new CardPaymentTargets(prisma);
    this.cardPaymentPlanner = new CardPaymentPlanner(
      cardPaymentImport,
      this.cardPaymentTargets,
      this.store,
    );
    this.reversalPlanner = new SignalReversalPlanner(
      ledger,
      new ReversalTargetResolver(prisma, ledger),
    );
    this.planner = new SignalImportPlanner({
      store: this.store,
      ledger,
      targets: this.targets,
      movementPlanner: new SignalMovementPlanner({
        prisma,
        targets: this.targets,
        ledger,
        merchants,
      }),
      reversalPlanner: this.reversalPlanner,
      cardPaymentPlanner: this.cardPaymentPlanner,
    });
    this.applier = new SignalImportApplier({
      store: this.store,
      importTransaction,
      reverseTransaction,
      ledger,
      cardPayments: this.cardPaymentPlanner,
    });
    this.previewReader = new SignalImportPreviewReader(
      this.targets,
      this.cardPaymentTargets,
      this.reversalPlanner,
    );
    this.reversalRetry = new PendingReversalRetry({
      prisma,
      store: this.store,
      planner: this.reversalPlanner,
      applier: this.applier,
    });
    this.pairing = new TransferPairing(prisma, importTransaction, baseCurrency);
  }

  async consume(signal: RoutedSignal): Promise<SignalConsumeResult> {
    return this.runImportPlan({ signal });
  }

  /**
   * Reaplica un import en revisión con la decisión de una persona. El override
   * no salta validaciones: el plan vuelve a comprobar destino, referencia,
   * moneda y monto, y si algo no cuadra el import sigue en revisión. Quien
   * llama ya tiene el bloqueo por usuario del import.
   */
  async consumeResolved({
    signal,
    override,
  }: ImportResolution): Promise<SignalConsumeResult> {
    return this.runImportPlan({ signal, override });
  }

  /** Igual que `consume`, pero sin escribir ni señales ni ledger. */
  async preview(signal: RoutedSignal): Promise<SignalImportPreview> {
    const plan = await this.planner.build({ signal });
    return this.previewReader.describe({ signal, plan });
  }

  private async runImportPlan({
    signal,
    override,
  }: {
    signal: RoutedSignal;
    override?: ImportResolutionOverride;
  }): Promise<SignalConsumeResult> {
    if (
      override ||
      !(await this.store.findRetryableReviewPending({
        userId: signal.userId,
        signalId: signal.signalId,
      }))
    ) {
      return this.importSignal({
        signal,
        override,
        lockHeld: Boolean(override),
      });
    }
    return this.prisma.$transaction(
      async (tx) => {
        await lockSignalImports({ tx, userId: signal.userId });
        return this.importSignal({ signal, lockHeld: true });
      },
      {
        timeout: SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS,
      },
    );
  }

  private async importSignal({
    signal,
    override,
    lockHeld,
  }: {
    signal: RoutedSignal;
    override?: ImportResolutionOverride;
    /** La resolución y los reintentos ya tienen el bloqueo por usuario. */
    lockHeld: boolean;
  }): Promise<SignalConsumeResult> {
    const plan = await this.planner.build({ signal, override });
    const consumeResult = await this.applyPlan(signal, plan, { lockHeld });
    if (
      consumeResult.outcome === 'ALREADY_APPLIED' &&
      this.isTransferSignal(signal)
    ) {
      const transactionId = consumeResult.domainReferences[0]?.id;
      if (transactionId) {
        await this.pairing.pair(signal.userId, transactionId);
      }
    }
    return consumeResult;
  }

  private isTransferSignal(signal: RoutedSignal): boolean {
    const payload = parseSignalPayload(signal.payload);
    return isTransferMovementClass(payload?.transaction?.movementClass);
  }

  private async applyPlan(
    signal: RoutedSignal,
    plan: ImportPlan,
    { lockHeld }: { lockHeld: boolean },
  ): Promise<SignalConsumeResult> {
    if (plan.kind === 'IMPORT') {
      return this.importMovement({ signal, draft: plan.draft, lockHeld });
    }
    return this.applier.apply(signal, plan);
  }

  /**
   * Un movimiento nuevo habilita dos pasos que solo él puede decidir: reintentar
   * los reversos que esperaban su original y emparejar la pata de una
   * transferencia.
   */
  private async importMovement({
    signal,
    draft,
    lockHeld,
  }: {
    signal: RoutedSignal;
    draft: ImportDraft;
    lockHeld: boolean;
  }): Promise<SignalConsumeResult> {
    const outcome = await this.applier.applyImport(signal, draft);
    if (outcome.kind === 'DONE') {
      return outcome.consumeResult;
    }
    if (!draft.input.linkedTransactionId && !draft.transfer) {
      await this.reversalRetry.run({ userId: signal.userId, lockHeld });
    }
    if (draft.transfer) {
      await this.pairing.pair(signal.userId, outcome.transactionId);
    }
    return buildConsumeResult('APPLIED', outcome.transactionId);
  }
}
