import { Injectable } from '@nestjs/common';
import { PrismaService, type Prisma } from '@personal-os/database';
import {
  resolveLedgerTargetFromHints,
  type LedgerTargetMatch,
} from '../ledger/application/resolve-ledger-target-from-hints';
import { uniqueCashAccountId } from '../ledger/application/match-imported-transfers';
import {
  classifyTransferImport,
  resolveTransferAccount,
  transferLegIdentity,
  TRANSFER_REVIEW_REASON,
  type IncomingTransferLeg,
  type TransferImportDecision,
  type TransferLegIdentity,
} from '../ledger/application/resolve-transfer-import';
import {
  isAtmMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import {
  reviewPlan,
  type ImportPlan,
  type ImportReviewEvidence,
} from './signal-import-plan';
import type { SignalCandidate } from './signal-import-payload';

const activeAccountSelect = {
  id: true,
  accountNumberLast4: true,
  isDefaultForInstitution: true,
  type: true,
  currency: true,
} satisfies Prisma.FinAccountSelect;

const activeCardSelect = {
  id: true,
  lastFour: true,
} satisfies Prisma.FinCardSelect;

export type ActiveLedgerAccount = Prisma.FinAccountGetPayload<{
  select: typeof activeAccountSelect;
}>;

export type ActiveLedgerCard = Prisma.FinCardGetPayload<{
  select: typeof activeCardSelect;
}>;

export type TransferTargetResolution =
  | { kind: 'resolved'; accountId: string; leg: TransferLegIdentity | null }
  | { kind: 'review'; reason: string; evidence: ImportReviewEvidence };

export type MovementDestination =
  | {
      kind: 'resolved';
      target: { accountId?: string; cardId?: string };
      transferLeg: TransferLegIdentity | null;
    }
  | { kind: 'review'; plan: ImportPlan };

/** Decide a qué cuenta o tarjeta del dueño pertenece un movimiento importado. */
@Injectable()
export class SignalImportTargets {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveAccounts(userId: string): Promise<ActiveLedgerAccount[]> {
    return this.prisma.finAccount.findMany({
      where: { userId, isActive: true },
      select: activeAccountSelect,
    });
  }

  async findActiveCards(userId: string): Promise<ActiveLedgerCard[]> {
    return this.prisma.finCard.findMany({
      where: { userId, isActive: true },
      select: activeCardSelect,
    });
  }

  async resolveCashAccountId(userId: string): Promise<string | null> {
    const cashAccounts = await this.prisma.finAccount.findMany({
      where: { userId, isActive: true, type: 'CASH' },
      select: { id: true },
    });
    return uniqueCashAccountId(cashAccounts);
  }

  resolveInstrumentTarget({
    candidate,
    movementClass,
    accounts,
    cards,
  }: {
    candidate: SignalCandidate;
    movementClass: MovementClass;
    accounts: readonly ActiveLedgerAccount[];
    cards: readonly ActiveLedgerCard[];
  }): LedgerTargetMatch {
    return resolveLedgerTargetFromHints({
      instrumentHint: null,
      lastFourHint: candidate.last4 ?? null,
      accountNumberHint: null,
      accounts: [...accounts],
      cards: [...cards],
      allowDefaultAccount: !isAtmMovementClass(movementClass),
    });
  }

  resolveTransferTarget({
    candidate,
    movementClass,
    accounts,
  }: {
    candidate: SignalCandidate;
    movementClass: MovementClass;
    accounts: readonly ActiveLedgerAccount[];
  }): TransferTargetResolution {
    const resolution = resolveTransferAccount({
      accountNumberHint: candidate.accountNumberLast4 ?? null,
      hasCardLast4Hint: Boolean(candidate.last4),
      accounts: [...accounts],
    });
    if (resolution.kind !== 'unique') {
      return {
        kind: 'review',
        reason: resolution.reason,
        evidence: {
          accountNumberHint: candidate.accountNumberLast4 ?? null,
          cardLast4Hint: candidate.last4 ?? null,
          ...(resolution.kind === 'ambiguous'
            ? { candidateAccountIds: resolution.candidateAccountIds }
            : {}),
        },
      };
    }
    return {
      kind: 'resolved',
      accountId: resolution.accountId,
      leg: transferLegIdentity(movementClass),
    };
  }

  /**
   * La decisión de una persona manda; sin ella, se resuelve por los últimos
   * cuatro del correo. Un destino imposible vuelve como motivo de revisión.
   */
  resolveDestination({
    candidate,
    movementClass,
    accounts,
    cards,
    destination,
  }: {
    candidate: SignalCandidate;
    movementClass: MovementClass;
    accounts: readonly ActiveLedgerAccount[];
    cards: readonly ActiveLedgerCard[];
    destination?: { accountId?: string; cardId?: string };
  }): MovementDestination {
    if (destination) {
      return this.resolveChosenDestination({ movementClass, destination });
    }
    if (isTransferMovementClass(movementClass)) {
      const transferTarget = this.resolveTransferTarget({
        candidate,
        movementClass,
        accounts,
      });
      if (transferTarget.kind === 'review') {
        return {
          kind: 'review',
          plan: reviewPlan(transferTarget.reason, transferTarget.evidence),
        };
      }
      return {
        kind: 'resolved',
        target: { accountId: transferTarget.accountId },
        transferLeg: transferTarget.leg,
      };
    }
    const ledgerTarget = this.resolveInstrumentTarget({
      candidate,
      movementClass,
      accounts,
      cards,
    });
    if (ledgerTarget.kind !== 'unique') {
      return {
        kind: 'review',
        plan: reviewPlan(
          ledgerTarget.kind === 'ambiguous'
            ? 'AMBIGUOUS_LEDGER_TARGET'
            : 'NO_LEDGER_TARGET',
          this.targetEvidence({ candidate, ledgerTarget, accounts, cards }),
        ),
      };
    }
    return {
      kind: 'resolved',
      target: {
        accountId: ledgerTarget.accountId,
        cardId: ledgerTarget.cardId,
      },
      transferLeg: null,
    };
  }

  async classifyAgainstSharedReference({
    userId,
    bankReference,
    incoming,
  }: {
    userId: string;
    bankReference: string;
    incoming: IncomingTransferLeg;
  }): Promise<TransferImportDecision> {
    // A terminal status must not hide a replay of the same leg.
    const referenceMatches = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        externalReference: bankReference,
      },
      select: {
        id: true,
        type: true,
        accountId: true,
        amount: true,
        currency: true,
        transactionDate: true,
      },
      orderBy: { transactionDate: 'desc' },
    });
    return classifyTransferImport({ incoming, existing: referenceMatches });
  }

  private resolveChosenDestination({
    movementClass,
    destination,
  }: {
    movementClass: MovementClass;
    destination: { accountId?: string; cardId?: string };
  }): MovementDestination {
    if (isTransferMovementClass(movementClass)) {
      if (!destination.accountId) {
        return {
          kind: 'review',
          plan: reviewPlan(TRANSFER_REVIEW_REASON.ACCOUNT_HINT_UNSUPPORTED),
        };
      }
      return {
        kind: 'resolved',
        target: { accountId: destination.accountId },
        transferLeg: transferLegIdentity(movementClass),
      };
    }
    if (destination.accountId && destination.cardId) {
      return { kind: 'review', plan: reviewPlan('AMBIGUOUS_LEDGER_TARGET') };
    }
    return { kind: 'resolved', target: destination, transferLeg: null };
  }

  private targetEvidence({
    candidate,
    ledgerTarget,
    accounts,
    cards,
  }: {
    candidate: SignalCandidate;
    ledgerTarget: LedgerTargetMatch;
    accounts: readonly ActiveLedgerAccount[];
    cards: readonly ActiveLedgerCard[];
  }): { candidateCount: number; candidateIds: string[] } | undefined {
    if (ledgerTarget.kind !== 'ambiguous') {
      return undefined;
    }
    return {
      candidateCount: ledgerTarget.candidateCount,
      candidateIds: [
        ...cards
          .filter(
            (card) => !candidate.last4 || card.lastFour === candidate.last4,
          )
          .map((card) => card.id),
        ...(candidate.last4 ? [] : accounts.map((account) => account.id)),
      ],
    };
  }
}
