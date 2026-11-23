import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { LedgerQueryRepositoryPort } from '../application/ports/ledger-query.repository.port';
import { PrismaLedgerCandidateReadRepository } from './prisma-ledger-candidate-read.repository';
import { PrismaLedgerTargetReadRepository } from './prisma-ledger-target-read.repository';
import { PrismaLedgerTransactionReadRepository } from './prisma-ledger-transaction-read.repository';

export {
  transactionLinkInclude,
  transactionPartyInclude,
} from './prisma-ledger-transaction-read.repository';

/**
 * Lecturas del ledger: los movimientos, los candidatos y los destinos viven en
 * su pieza y aquí solo se delegan, con el mismo constructor de siempre.
 */
@Injectable()
export class PrismaLedgerReadRepository implements LedgerQueryRepositoryPort {
  private readonly transactions: PrismaLedgerTransactionReadRepository;
  private readonly candidates: PrismaLedgerCandidateReadRepository;
  private readonly targets: PrismaLedgerTargetReadRepository;

  constructor(private readonly prisma: PrismaService) {
    this.transactions = new PrismaLedgerTransactionReadRepository(prisma);
    this.candidates = new PrismaLedgerCandidateReadRepository(prisma);
    this.targets = new PrismaLedgerTargetReadRepository(prisma);
  }

  findTransactions(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactions']
    >
  ) {
    return this.transactions.findTransactions(...args);
  }

  findTransactionById(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactionById']
    >
  ) {
    return this.transactions.findTransactionById(...args);
  }

  findTransactionsByIds(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactionsByIds']
    >
  ) {
    return this.transactions.findTransactionsByIds(...args);
  }

  findPlanningLinkKind(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findPlanningLinkKind']
    >
  ) {
    return this.transactions.findPlanningLinkKind(...args);
  }

  findTransactionByImportReference(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactionByImportReference']
    >
  ) {
    return this.transactions.findTransactionByImportReference(...args);
  }

  findTransactionsByTransferGroupId(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactionsByTransferGroupId']
    >
  ) {
    return this.transactions.findTransactionsByTransferGroupId(...args);
  }

  findTransactionsByTransferGroupIds(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactionsByTransferGroupIds']
    >
  ) {
    return this.transactions.findTransactionsByTransferGroupIds(...args);
  }

  findTransactionByExternalReference(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactionByExternalReference']
    >
  ) {
    return this.transactions.findTransactionByExternalReference(...args);
  }

  findTransactionsByExternalReference(
    ...args: Parameters<
      PrismaLedgerTransactionReadRepository['findTransactionsByExternalReference']
    >
  ) {
    return this.transactions.findTransactionsByExternalReference(...args);
  }

  findCandidatesForReverse(
    ...args: Parameters<
      PrismaLedgerCandidateReadRepository['findCandidatesForReverse']
    >
  ) {
    return this.candidates.findCandidatesForReverse(...args);
  }

  findReverseCandidatesByCard(
    ...args: Parameters<
      PrismaLedgerCandidateReadRepository['findReverseCandidatesByCard']
    >
  ) {
    return this.candidates.findReverseCandidatesByCard(...args);
  }

  findImportedTransactionByEmailMessageId(
    ...args: Parameters<
      PrismaLedgerCandidateReadRepository['findImportedTransactionByEmailMessageId']
    >
  ) {
    return this.candidates.findImportedTransactionByEmailMessageId(...args);
  }

  findLinkedRefundTotal(
    ...args: Parameters<
      PrismaLedgerCandidateReadRepository['findLinkedRefundTotal']
    >
  ) {
    return this.candidates.findLinkedRefundTotal(...args);
  }

  findPossibleDuplicate(
    ...args: Parameters<
      PrismaLedgerCandidateReadRepository['findPossibleDuplicate']
    >
  ) {
    return this.candidates.findPossibleDuplicate(...args);
  }

  findDedupeCandidate(
    ...args: Parameters<
      PrismaLedgerCandidateReadRepository['findDedupeCandidate']
    >
  ) {
    return this.candidates.findDedupeCandidate(...args);
  }

  findLatestCategoryIdByMerchant(
    ...args: Parameters<
      PrismaLedgerCandidateReadRepository['findLatestCategoryIdByMerchant']
    >
  ) {
    return this.candidates.findLatestCategoryIdByMerchant(...args);
  }

  findAccountById(
    ...args: Parameters<PrismaLedgerTargetReadRepository['findAccountById']>
  ) {
    return this.targets.findAccountById(...args);
  }

  findCardLedgerContext(
    ...args: Parameters<
      PrismaLedgerTargetReadRepository['findCardLedgerContext']
    >
  ) {
    return this.targets.findCardLedgerContext(...args);
  }

  findSavingsGoalIdByAccount(
    ...args: Parameters<
      PrismaLedgerTargetReadRepository['findSavingsGoalIdByAccount']
    >
  ) {
    return this.targets.findSavingsGoalIdByAccount(...args);
  }

  findBalanceAdjustmentTarget(
    ...args: Parameters<
      PrismaLedgerTargetReadRepository['findBalanceAdjustmentTarget']
    >
  ) {
    return this.targets.findBalanceAdjustmentTarget(...args);
  }
}
