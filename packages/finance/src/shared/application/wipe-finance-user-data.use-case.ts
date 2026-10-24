import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Prisma, PrismaService } from '@personal-os/database';
import { LogoService } from '@personal-os/logos';
import { QueueNames, type GmailSyncJob } from '@personal-os/core';
import { gmailSyncJobId } from '../../ingestion/application/gmail-sync.constants';
import type { DataBranchDescriptor } from '@personal-os/users';
import {
  FINANCE_DATA_BRANCHES,
  layerForBranch,
} from '../domain/finance-data-branches';
import type { FinanceWipeLayer } from '../domain/finance-wipe-layers';

type TxClient = Prisma.TransactionClient;

/** Rows a branch removed, from the detailed counts of its wipe. */
function rowsForBranch(branchId: string, counts: FinanceWipeCounts): number {
  switch (branchId) {
    case 'finance.ledger':
      return counts.transactions;
    case 'finance.balances':
      return counts.accountBalances + counts.cardBalances;
    case 'finance.planning':
      return (
        counts.budgets + counts.savingsGoals + counts.loans + counts.receivables
      );
    case 'finance.categories':
      return counts.categories;
    case 'finance.catalog':
      return counts.institutions + counts.accounts + counts.cards;
    case 'finance.emailConnections':
      return counts.emailConnections;
    default:
      return 0;
  }
}

export type FinanceWipeCounts = {
  transactions: number;
  emailMessages: number;
  emailSyncLogs: number;
  recurringPatterns: number;
  merchants: number;
  budgets: number;
  savingsGoals: number;
  loans: number;
  receivables: number;
  categories: number;
  institutions: number;
  accounts: number;
  cards: number;
  emailConnections: number;
  accountBalances: number;
  cardBalances: number;
};

function emptyCounts(): FinanceWipeCounts {
  return {
    transactions: 0,
    emailMessages: 0,
    emailSyncLogs: 0,
    recurringPatterns: 0,
    merchants: 0,
    budgets: 0,
    savingsGoals: 0,
    loans: 0,
    receivables: 0,
    categories: 0,
    institutions: 0,
    accounts: 0,
    cards: 0,
    emailConnections: 0,
    accountBalances: 0,
    cardBalances: 0,
  };
}

/**
 * Bulk finance wipe. Never reuses the per-instrument purge: that would emit one
 * outbox event per transaction and flood the AI/notifications listeners.
 */
@Injectable()
export class WipeFinanceUserDataUseCase {
  private readonly logger = new Logger(WipeFinanceUserDataUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly logos: LogoService,
    @Optional()
    @InjectQueue(QueueNames.GMAIL_SYNC)
    private readonly gmailSyncQueue?: Queue<GmailSyncJob>,
  ) {}

  /** Branch registry this package declares, consulted by the orchestrator. */
  dataBranches(): readonly DataBranchDescriptor[] {
    return FINANCE_DATA_BRANCHES;
  }

  /** Rows each branch would delete today, with the same rules as the wipe. */
  async countBranches(
    userId: string,
    branchIds: readonly string[],
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const branchId of branchIds) {
      counts[branchId] = await this.countBranch(userId, branchId);
    }
    return counts;
  }

  /** Applies the branches in one transaction and returns what each removed. */
  async wipeBranches(
    userId: string,
    branchIds: readonly string[],
    options?: { balanceInstitutionId?: string },
  ): Promise<Record<string, number>> {
    const counts = await this.execute(
      userId,
      branchIds.map(layerForBranch),
      options,
    );
    return Object.fromEntries(
      branchIds.map((branchId) => [branchId, rowsForBranch(branchId, counts)]),
    );
  }

  private async countBranch(userId: string, branchId: string): Promise<number> {
    switch (branchId) {
      case 'finance.ledger':
        return this.prisma.finTransaction.count({ where: { userId } });
      case 'finance.balances':
        return (
          (await this.prisma.finAccount.count({ where: { userId } })) +
          (await this.prisma.finCardBalance.count({
            where: { card: { userId } },
          }))
        );
      case 'finance.planning':
        return (
          (await this.prisma.finBudget.count({ where: { userId } })) +
          (await this.prisma.finSavingsGoal.count({ where: { userId } })) +
          (await this.prisma.finLoan.count({ where: { userId } })) +
          (await this.prisma.finReceivable.count({ where: { userId } }))
        );
      case 'finance.categories':
        return this.prisma.finCategory.count({
          where: { userId, isSystem: false },
        });
      case 'finance.catalog':
        return (
          (await this.prisma.finInstitution.count({
            where: { userId, isSystem: false },
          })) +
          (await this.prisma.finAccount.count({ where: { userId } })) +
          (await this.prisma.finCard.count({ where: { userId } }))
        );
      case 'finance.emailConnections':
        return this.prisma.finEmailConnection.count({ where: { userId } });
      default:
        return 0;
    }
  }

  async execute(
    userId: string,
    layers: readonly FinanceWipeLayer[],
    options?: { balanceInstitutionId?: string },
  ): Promise<FinanceWipeCounts> {
    const selected = new Set<FinanceWipeLayer>(layers);
    const sourceIds = await this.findSourceIds(userId);
    await this.cancelGmailSyncJobs(sourceIds);

    const customLogoPaths = await this.findCustomLogoPaths(userId, selected);

    const counts = await this.prisma.$transaction(async (tx) => {
      const applied = emptyCounts();
      if (selected.has('finance.ledger')) {
        Object.assign(applied, await this.wipeLedger(tx, userId, sourceIds));
      }
      if (selected.has('finance.balances')) {
        Object.assign(
          applied,
          await this.wipeBalances(tx, userId, options?.balanceInstitutionId),
        );
      }
      if (selected.has('finance.planning')) {
        Object.assign(applied, await this.wipePlanning(tx, userId));
      }
      if (selected.has('finance.categories')) {
        Object.assign(applied, await this.wipeCategories(tx, userId));
      }
      if (selected.has('finance.catalog')) {
        Object.assign(applied, await this.wipeCatalog(tx, userId));
      }
      if (selected.has('finance.emailConnections')) {
        const deleted = await tx.finEmailConnection.deleteMany({
          where: { userId },
        });
        applied.emailConnections = deleted.count;
      }
      return applied;
    });

    await this.deleteCustomLogos(customLogoPaths);
    return counts;
  }

  private findSourceIds(userId: string): Promise<Array<{ id: string }>> {
    return this.prisma.finEmailSource.findMany({
      where: { userId },
      select: { id: true },
    });
  }

  /** Own logo files the selected layers are about to orphan. */
  private async findCustomLogoPaths(
    userId: string,
    selected: ReadonlySet<FinanceWipeLayer>,
  ): Promise<string[]> {
    const paths: string[] = [];
    if (selected.has('finance.catalog')) {
      const institutions = await this.prisma.finInstitution.findMany({
        where: { userId, customLogoPath: { not: null } },
        select: { customLogoPath: true },
      });
      paths.push(
        ...institutions.flatMap((row) =>
          row.customLogoPath ? [row.customLogoPath] : [],
        ),
      );
    }
    if (selected.has('finance.ledger')) {
      const merchants = await this.prisma.finMerchant.findMany({
        where: { userId, customLogoPath: { not: null } },
        select: { customLogoPath: true },
      });
      paths.push(
        ...merchants.flatMap((row) =>
          row.customLogoPath ? [row.customLogoPath] : [],
        ),
      );
    }
    return paths;
  }

  private async cancelGmailSyncJobs(sourceIds: Array<{ id: string }>) {
    if (!this.gmailSyncQueue || sourceIds.length === 0) {
      return;
    }
    for (const source of sourceIds) {
      try {
        await this.gmailSyncQueue.remove(gmailSyncJobId(source.id));
      } catch (error) {
        this.logger.warn(
          `Failed to cancel Gmail sync job for source ${source.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  private async deleteCustomLogos(paths: readonly string[]) {
    for (const path of paths) {
      await this.logos.deleteCustomLogo(path);
    }
  }

  private async wipeLedger(
    tx: TxClient,
    userId: string,
    sourceIds: Array<{ id: string }>,
  ): Promise<Partial<FinanceWipeCounts>> {
    const sourceIdList = sourceIds.map((source) => source.id);
    // Adjustments hold the movement with a RESTRICT foreign key, so the
    // closes go first and cascade their lines before the movements.
    await tx.finReconciliation.deleteMany({ where: { userId } });
    const transactions = await tx.finTransaction.deleteMany({
      where: { userId },
    });
    const emailMessages = await tx.finEmailMessage.deleteMany({
      where: { sourceId: { in: sourceIdList } },
    });
    const emailSyncLogs = await tx.finEmailSyncLog.deleteMany({
      where: { sourceId: { in: sourceIdList } },
    });
    const recurringPatterns = await tx.finRecurringPattern.deleteMany({
      where: { userId },
    });
    const merchants = await tx.finMerchant.deleteMany({ where: { userId } });
    await tx.finAccount.updateMany({
      where: { userId },
      data: { balance: 0 },
    });
    await this.resetCardBalances(tx, userId);
    await tx.finBudget.updateMany({
      where: { userId },
      data: { amountSpent: 0 },
    });
    return {
      transactions: transactions.count,
      emailMessages: emailMessages.count,
      emailSyncLogs: emailSyncLogs.count,
      recurringPatterns: recurringPatterns.count,
      merchants: merchants.count,
    };
  }

  private async wipeBalances(
    tx: TxClient,
    userId: string,
    institutionId?: string,
  ): Promise<Partial<FinanceWipeCounts>> {
    if (institutionId) {
      const institution = await tx.finInstitution.findFirst({
        where: { id: institutionId, userId },
        select: { id: true },
      });
      if (!institution) {
        throw new NotFoundException('Institución no encontrada');
      }
    }
    const accounts = await tx.finAccount.updateMany({
      where: institutionId ? { userId, institutionId } : { userId },
      data: { balance: 0 },
    });
    const cardBalances = await this.resetCardBalances(
      tx,
      userId,
      institutionId,
    );
    return {
      accountBalances: accounts.count,
      cardBalances,
    };
  }

  /**
   * Credit-card `balance` is available credit. Restoring it to the limit
   * clears the debt the balance sheet shows. Debit cards hold cash, so
   * those rows go to zero.
   */
  private async resetCardBalances(
    tx: TxClient,
    userId: string,
    institutionId?: string,
  ): Promise<number> {
    const restored = await tx.$executeRaw`
      UPDATE fin_card_balances AS b
      SET balance = b.credit_limit,
          updated_at = NOW()
      FROM fin_cards AS c
      WHERE b.card_id = c.id
        AND c.user_id = ${userId}
        AND c.type = 'CREDIT'::"FinCardType"
        AND b.credit_limit IS NOT NULL
        ${
          institutionId
            ? Prisma.sql`AND c.institution_id = ${institutionId}`
            : Prisma.empty
        }
    `;
    const debits = await tx.finCardBalance.updateMany({
      where: {
        card: institutionId
          ? { userId, institutionId, type: 'DEBIT' }
          : { userId, type: 'DEBIT' },
      },
      data: { balance: 0 },
    });
    return Number(restored) + debits.count;
  }

  private async wipePlanning(
    tx: TxClient,
    userId: string,
  ): Promise<Partial<FinanceWipeCounts>> {
    const budgets = await tx.finBudget.deleteMany({ where: { userId } });
    const savingsGoals = await tx.finSavingsGoal.deleteMany({
      where: { userId },
    });
    const loans = await tx.finLoan.deleteMany({ where: { userId } });
    const receivables = await tx.finReceivable.deleteMany({
      where: { userId },
    });
    return {
      budgets: budgets.count,
      savingsGoals: savingsGoals.count,
      loans: loans.count,
      receivables: receivables.count,
    };
  }

  private async wipeCategories(
    tx: TxClient,
    userId: string,
  ): Promise<Partial<FinanceWipeCounts>> {
    const categories = await tx.finCategory.deleteMany({
      where: { userId, isSystem: false },
    });
    return { categories: categories.count };
  }

  private async wipeCatalog(
    tx: TxClient,
    userId: string,
  ): Promise<Partial<FinanceWipeCounts>> {
    const [institutions, accounts, cards] = await Promise.all([
      tx.finInstitution.count({ where: { userId, isSystem: false } }),
      tx.finAccount.count({ where: { userId } }),
      tx.finCard.count({ where: { userId } }),
    ]);
    // The system "Efectivo" institution survives the wipe and is refilled by
    // ensureCashInstitution; non-system institutions cascade their products.
    await tx.finInstitution.deleteMany({ where: { userId, isSystem: false } });
    // Cash accounts live in the system institution and are emptied, not kept.
    await tx.finAccount.deleteMany({ where: { userId } });
    await tx.finCard.deleteMany({ where: { userId } });
    return { institutions, accounts, cards };
  }
}
