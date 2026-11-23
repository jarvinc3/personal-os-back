import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { buildFinancialImportNotes } from '../ledger/application/build-import-notes';
import type { TransferLegIdentity } from '../ledger/application/resolve-transfer-import';
import {
  isAtmMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import type { FinTransactionStatusValue } from '../shared/domain/transaction-status';
import { UNKNOWN_MERCHANT } from '../shared/domain/unknown-merchant';
import {
  buildSignalImportMetadata,
  reviewPlan,
  type ImportDraft,
  type ImportPlan,
  type ImportResolutionOverride,
} from './signal-import-plan';
import { SignalMovementCategory } from './signal-movement-category';
import { SignalMovementDuplicate } from './signal-movement-duplicate';
import type { SignalCandidate, SignalPayload } from './signal-import-payload';
import { SignalImportTargets } from './signal-import-targets';
import type {
  ActiveLedgerAccount,
  ActiveLedgerCard,
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
@Injectable()
export class SignalMovementPlanner {
  constructor(
    private readonly targets: SignalImportTargets,
    private readonly duplicate: SignalMovementDuplicate,
    private readonly category: SignalMovementCategory,
  ) {}

  async plan(input: MovementPlanInput): Promise<ImportPlan> {
    const transfer = isTransferMovementClass(input.movementClass);
    const destination = this.targets.resolveDestination({
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

    const duplicate = await this.duplicate.resolve(resolved);
    if (duplicate) {
      return duplicate;
    }

    const category = await this.category.resolve(resolved);
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
      ? await this.targets.resolveCashAccountId(input.signal.userId)
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
