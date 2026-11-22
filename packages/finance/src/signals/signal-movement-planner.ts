import type { RoutedSignal } from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { buildFinancialImportNotes } from '../ledger/application/build-import-notes';
import type { LedgerQueryService } from '../ledger/application/ledger-query.service';
import type { TransferLegIdentity } from '../ledger/application/resolve-transfer-import';
import {
  isAtmMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import type { MerchantsService } from '../merchants/application/merchants.service';
import {
  resolveCategoryIdForImport,
  type CategoryResolveSource,
} from '../shared/domain/category-type';
import type { FinTransactionStatusValue } from '../shared/domain/transaction-status';
import { UNKNOWN_MERCHANT } from '../shared/domain/unknown-merchant';
import {
  buildSignalImportMetadata,
  duplicatePlan,
  reviewPlan,
  type ImportDraft,
  type ImportPlan,
  type ImportResolutionOverride,
} from './signal-import-plan';
import type { SignalCandidate, SignalPayload } from './signal-import-payload';
import type {
  ActiveLedgerAccount,
  ActiveLedgerCard,
  SignalImportTargets,
} from './signal-import-targets';

type MovementPlanInput = {
  signal: RoutedSignal;
  payload: SignalPayload;
  candidate: SignalCandidate;
  movementClass: MovementClass;
  type: 'DEBIT' | 'CREDIT';
  status: FinTransactionStatusValue;
  amount: number;
  currency: string;
  transactionDate: Date;
  accounts: readonly ActiveLedgerAccount[];
  cards: readonly ActiveLedgerCard[];
  override?: ImportResolutionOverride;
};

type ResolvedMovement = MovementPlanInput & {
  transfer: boolean;
  transferLeg: TransferLegIdentity | null;
  target: { accountId?: string; cardId?: string };
};

/** Plan de un movimiento suelto: compra, ingreso, cajero o pata de transferencia. */
export class SignalMovementPlanner {
  constructor(
    private readonly deps: {
      prisma: PrismaService;
      targets: SignalImportTargets;
      ledger: LedgerQueryService;
      merchants: MerchantsService;
    },
  ) {}

  async plan(input: MovementPlanInput): Promise<ImportPlan> {
    const transfer = isTransferMovementClass(input.movementClass);
    const destination = this.deps.targets.resolveDestination({
      candidate: input.candidate,
      movementClass: input.movementClass,
      accounts: input.accounts,
      cards: input.cards,
      destination: input.override?.destination,
    });
    if (destination.kind === 'review') {
      return destination.plan;
    }
    const resolved: ResolvedMovement = {
      ...input,
      transfer,
      transferLeg: destination.transferLeg,
      target: destination.target,
    };

    const duplicate = await this.resolveDuplicate(resolved);
    if (duplicate) {
      return duplicate;
    }

    const category = await this.resolveCategory(resolved);
    const notes = buildFinancialImportNotes({
      llmNotes: null,
      categoryId: category.categoryId,
      categorySource: category.source,
      categoryNameHint: input.candidate.categoryNameHint ?? null,
      status: input.status,
      skipUncategorizedWarning:
        transfer || isAtmMovementClass(input.movementClass),
    });

    const cashAccountId = isAtmMovementClass(input.movementClass)
      ? await this.deps.targets.resolveCashAccountId(input.signal.userId)
      : null;
    if (isAtmMovementClass(input.movementClass) && !cashAccountId) {
      return reviewPlan('ATM_CASH_ACCOUNT_AMBIGUOUS');
    }

    return {
      kind: 'IMPORT',
      draft: this.buildDraft({
        ...resolved,
        cashAccountId,
        categoryId: category.categoryId,
        notes,
      }),
    };
  }

  private async resolveDuplicate({
    signal,
    candidate,
    type,
    amount,
    currency,
    transactionDate,
    transfer,
    transferLeg,
    target,
  }: ResolvedMovement): Promise<ImportPlan | null> {
    if (
      transfer &&
      transferLeg &&
      target.accountId &&
      candidate.bankReference
    ) {
      const decision = await this.deps.targets.classifyAgainstSharedReference({
        userId: signal.userId,
        bankReference: candidate.bankReference,
        incoming: {
          type: transferLeg.type,
          accountId: target.accountId,
          amount,
          currency,
          transactionDate,
        },
      });
      if (decision.kind === 'duplicate') {
        return duplicatePlan(decision.transactionId);
      }
      if (decision.kind === 'conflict') {
        return reviewPlan(decision.reason, {
          externalReference: candidate.bankReference,
          candidateTransactionIds: decision.candidateTransactionIds,
        });
      }
      return null;
    }
    const duplicate = await this.deps.ledger.findDedupeCandidate(
      signal.userId,
      {
        externalReference: candidate.bankReference ?? null,
        accountId: target.accountId,
        cardId: target.cardId,
        amount,
        currency,
        type,
        merchant: candidate.merchant ?? null,
        transactionDate,
      },
    );
    return duplicate ? duplicatePlan(duplicate.id) : null;
  }

  private async resolveCategory({
    signal,
    candidate,
    movementClass,
    transfer,
    type,
  }: ResolvedMovement): Promise<{
    categoryId: string | null;
    source: CategoryResolveSource | null;
  }> {
    if (transfer || isAtmMovementClass(movementClass)) {
      return { categoryId: null, source: null };
    }
    const categories = await this.deps.prisma.finCategory.findMany({
      where: {
        type: type === 'DEBIT' ? 'EXPENSE' : 'INCOME',
        OR: [{ userId: signal.userId }, { isSystem: true }],
      },
      select: { id: true, name: true, type: true },
    });
    return resolveCategoryIdForImport({
      categories,
      hint: candidate.categoryNameHint ?? null,
      transactionType: type,
      merchant: candidate.merchant ?? null,
      findMerchantCategoryId: async (merchant) =>
        (await this.deps.merchants.suggest(signal.userId, merchant))
          ?.categoryId ?? null,
      findCategoryIdByMerchant: (merchant) =>
        this.deps.ledger.findLatestCategoryIdByMerchant(
          signal.userId,
          merchant,
        ),
    });
  }

  private buildDraft({
    signal,
    payload,
    candidate,
    movementClass,
    type,
    status,
    amount,
    currency,
    transactionDate,
    transfer,
    transferLeg,
    target,
    cashAccountId,
    categoryId,
    notes,
  }: ResolvedMovement & {
    cashAccountId: string | null;
    categoryId: string | null;
    notes: string | null;
  }): ImportDraft {
    const merchantMissing = !candidate.merchant;
    const merchant = candidate.merchant ?? UNKNOWN_MERCHANT;
    const aiMetadata = {
      ...buildSignalImportMetadata({
        signal,
        payload,
        candidate,
        movementClass,
        amount,
        currency,
      }),
      merchantMissing,
    };
    return {
      cashAccountId,
      transfer,
      input: {
        accountId: target.accountId,
        cardId: target.cardId,
        importReference: signal.signalId,
        externalReference: candidate.bankReference,
        amount,
        currency,
        merchant,
        merchantIsPlaceholder: merchantMissing,
        description:
          candidate.merchant ?? payload.semanticType ?? 'Movimiento por correo',
        notes,
        transactionDate,
        type: transferLeg?.type ?? type,
        legRole: transferLeg?.legRole,
        status,
        categoryId,
        aiMetadata,
      },
    };
  }
}
