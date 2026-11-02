import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@personal-os/database';
import { LogoService } from '@personal-os/logos';
import type { DataBranchDescriptor } from '@personal-os/users';
import { FINANCE_DATA_BRANCHES } from '../domain/finance-data-branches';
type TxClient = Prisma.TransactionClient;
/** What one branch removed, so each branch reports its own count. */
export type FinanceWipeBranchResult = {
  primary: number;
};
/**
 * Bulk finance wipe by data branch. Never reuses the per-instrument purge: that
 * would emit one outbox event per transaction and flood the listeners.
 */
@Injectable()
export class WipeFinanceUserDataUseCase {
  private readonly logger = new Logger(WipeFinanceUserDataUseCase.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly logos: LogoService,
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
    this.assertKnownBranches(branchIds);
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
    options?: {
      balanceInstitutionId?: string;
    },
  ): Promise<Record<string, number>> {
    this.assertKnownBranches(branchIds);
    const logoPaths = await this.findLogoPaths(userId, branchIds);
    const counts = await this.prisma.$transaction(async (tx) => {
      const applied: Record<string, number> = {};
      for (const branchId of branchIds) {
        applied[branchId] = await this.applyBranch(tx, {
          userId,
          branchId,
          balanceInstitutionId: options?.balanceInstitutionId,
        });
      }
      return applied;
    });
    await this.deleteLogos(logoPaths);
    return counts;
  }
  private async applyBranch(
    tx: TxClient,
    input: {
      userId: string;
      branchId: string;
      balanceInstitutionId?: string;
    },
  ): Promise<number> {
    const handler = this.branchHandlers()[input.branchId];
    if (!handler) {
      return 0;
    }
    return handler(tx, input);
  }
  private assertKnownBranches(branchIds: readonly string[]): void {
    const known = new Set(FINANCE_DATA_BRANCHES.map(({ id }) => id));
    const unknown = branchIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException({
        message: 'Una o más ramas de datos ya no están disponibles',
        branches: unknown,
      });
    }
  }
  /**
   * One handler per branch. The order the orchestrator applies comes from the
   * registry, so a branch that needs another one to go first declares it there.
   */
  private branchHandlers(): Record<
    string,
    (
      tx: TxClient,
      input: {
        userId: string;
        balanceInstitutionId?: string;
      },
    ) => Promise<number>
  > {
    return {
      'finance.reconciliations': async (tx, { userId }) => {
        const reconciliations = await tx.finReconciliation.deleteMany({
          where: { userId },
        });
        const drifts = await tx.finBalanceDrift.deleteMany({
          where: { userId },
        });
        return reconciliations.count + drifts.count;
      },
      'finance.transactions': async (tx, { userId }) => {
        const signalImports = await tx.finSignalImport.deleteMany({
          where: { userId },
        });
        const transactions = await tx.finTransaction.deleteMany({
          where: { userId },
        });
        await tx.finAccount.updateMany({
          where: { userId },
          data: { balance: 0 },
        });
        await this.resetCardBalances(tx, userId);
        await tx.finBudget.updateMany({
          where: { userId },
          data: { amountSpent: 0 },
        });
        return transactions.count + signalImports.count;
      },
      'finance.balances': (tx, { userId, balanceInstitutionId }) =>
        this.resetBalances(tx, userId, balanceInstitutionId),
      'finance.cards': async (tx, { userId }) => {
        const cards = await tx.finCard.deleteMany({
          where: { userId, type: 'CREDIT' },
        });
        return cards.count;
      },
      'finance.debitCards': async (tx, { userId }) => {
        const cards = await tx.finCard.deleteMany({
          where: { userId, type: 'DEBIT' },
        });
        return cards.count;
      },
      'finance.accounts': async (tx, { userId }) => {
        const accounts = await tx.finAccount.deleteMany({ where: { userId } });
        return accounts.count;
      },
      'finance.institutions': (tx, { userId }) =>
        this.wipeInstitutions(tx, userId),
      'finance.subscriptions': async (tx, { userId }) => {
        await tx.finSubscriptionPayment.deleteMany({
          where: { subscription: { userId } },
        });
        await tx.finSubscriptionAlertDismissal.deleteMany({
          where: { userId },
        });
        const subscriptions = await tx.finSubscription.deleteMany({
          where: { userId },
        });
        return subscriptions.count;
      },
      'finance.recurring': async (tx, { userId }) => {
        const patterns = await tx.finRecurringPattern.deleteMany({
          where: { userId },
        });
        return patterns.count;
      },
      'finance.merchants': async (tx, { userId }) => {
        const merchants = await tx.finMerchant.deleteMany({
          where: { userId },
        });
        return merchants.count;
      },
      'finance.statements': async (tx, { userId }) => {
        // The split by account is disjoint: an import billed from an account
        // travels with the accounts and the rest stays here, so each row is
        // counted by exactly one branch.
        const imports = await tx.finStatementImport.deleteMany({
          where: { userId, accountId: null },
        });
        const statements = await tx.finCardStatement.deleteMany({
          where: { card: { userId } },
        });
        return imports.count + statements.count;
      },
      'finance.accountImports': async (tx, { userId }) => {
        const imports = await tx.finStatementImport.deleteMany({
          where: { userId, accountId: { not: null } },
        });
        return imports.count;
      },
      'finance.loans': async (tx, { userId }) => {
        const loans = await tx.finLoan.deleteMany({ where: { userId } });
        return loans.count;
      },
      'finance.savingsGoals': async (tx, { userId }) => {
        const goals = await tx.finSavingsGoal.deleteMany({ where: { userId } });
        return goals.count;
      },
      'finance.receivables': async (tx, { userId }) => {
        const receivables = await tx.finReceivable.deleteMany({
          where: { userId },
        });
        return receivables.count;
      },
      'finance.budgets': async (tx, { userId }) => {
        const budgets = await tx.finBudget.deleteMany({ where: { userId } });
        return budgets.count;
      },
      'finance.categories': async (tx, { userId }) => {
        const categories = await tx.finCategory.deleteMany({
          where: { userId, isSystem: false },
        });
        return categories.count;
      },
    };
  }
  private async countBranch(userId: string, branchId: string): Promise<number> {
    switch (branchId) {
      case 'finance.reconciliations':
        return (
          (await this.prisma.finReconciliation.count({ where: { userId } })) +
          (await this.prisma.finBalanceDrift.count({
            where: { userId, resolvedAt: null },
          }))
        );
      case 'finance.transactions':
        return (
          (await this.prisma.finTransaction.count({ where: { userId } })) +
          (await this.prisma.finSignalImport.count({ where: { userId } }))
        );
      case 'finance.balances':
        return (
          (await this.prisma.finAccount.count({ where: { userId } })) +
          (await this.prisma.finCardBalance.count({
            where: { card: { userId } },
          }))
        );
      case 'finance.cards':
        return this.prisma.finCard.count({
          where: { userId, type: 'CREDIT' },
        });
      case 'finance.debitCards':
        return this.prisma.finCard.count({
          where: { userId, type: 'DEBIT' },
        });
      case 'finance.accounts':
        return this.prisma.finAccount.count({ where: { userId } });
      case 'finance.institutions':
        return this.prisma.finInstitution.count({
          where: { userId, isSystem: false },
        });
      case 'finance.subscriptions':
        return this.prisma.finSubscription.count({ where: { userId } });
      case 'finance.recurring':
        return this.prisma.finRecurringPattern.count({ where: { userId } });
      case 'finance.merchants':
        return this.prisma.finMerchant.count({ where: { userId } });
      case 'finance.statements':
        return (
          (await this.prisma.finStatementImport.count({
            where: { userId, accountId: null },
          })) +
          (await this.prisma.finCardStatement.count({
            where: { card: { userId } },
          }))
        );
      case 'finance.accountImports':
        return this.prisma.finStatementImport.count({
          where: { userId, accountId: { not: null } },
        });
      case 'finance.loans':
        return this.prisma.finLoan.count({ where: { userId } });
      case 'finance.savingsGoals':
        return this.prisma.finSavingsGoal.count({ where: { userId } });
      case 'finance.receivables':
        return this.prisma.finReceivable.count({ where: { userId } });
      case 'finance.budgets':
        return this.prisma.finBudget.count({ where: { userId } });
      case 'finance.categories':
        return this.prisma.finCategory.count({
          where: { userId, isSystem: false },
        });
      default:
        return 0;
    }
  }
  private async findLogoPaths(
    userId: string,
    branchIds: readonly string[],
  ): Promise<string[]> {
    const paths: string[] = [];
    if (branchIds.includes('finance.institutions')) {
      const institutions = await this.prisma.finInstitution.findMany({
        where: { userId, isSystem: false, customLogoPath: { not: null } },
        select: { customLogoPath: true },
      });
      paths.push(
        ...institutions.flatMap((row) =>
          row.customLogoPath ? [row.customLogoPath] : [],
        ),
      );
    }
    if (branchIds.includes('finance.merchants')) {
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
  private async deleteLogos(paths: readonly string[]) {
    for (const path of paths) {
      await this.logos.deleteCustomLogo(path);
    }
  }
  private async resetBalances(
    tx: TxClient,
    userId: string,
    institutionId?: string,
  ): Promise<number> {
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
    return accounts.count + cardBalances;
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
  /**
   * Non-system institutions go, and with them their accounts, cards and what
   * those drag. The system "Efectivo" institution survives.
   */
  private async wipeInstitutions(
    tx: TxClient,
    userId: string,
  ): Promise<number> {
    const institutions = await tx.finInstitution.findMany({
      where: { userId, isSystem: false },
      select: { id: true },
    });
    const institutionIds = institutions.map((institution) => institution.id);
    await tx.finLoan.deleteMany({
      where: { userId, institutionId: { in: institutionIds } },
    });
    // Accounts, cards and mail sources (with their messages) cascade.
    const deleted = await tx.finInstitution.deleteMany({
      where: { userId, isSystem: false },
    });
    return deleted.count;
  }
}
