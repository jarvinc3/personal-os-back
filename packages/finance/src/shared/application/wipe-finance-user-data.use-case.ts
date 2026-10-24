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
import type { DataBranchDescriptor } from '@personal-os/users';
import { gmailSyncJobId } from '../../ingestion/application/gmail-sync.constants';
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
    const sourceIds = await this.affectedSourceIds(userId, branchIds);
    await this.cancelGmailSyncJobs(sourceIds);

    const logoPaths = await this.findLogoPaths(userId, branchIds);

    const counts = await this.prisma.$transaction(async (tx) => {
      const applied: Record<string, number> = {};
      for (const branchId of branchIds) {
        applied[branchId] = await this.applyBranch(tx, {
          userId,
          branchId,
          sourceIds,
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
      sourceIds: readonly string[];
      balanceInstitutionId?: string;
    },
  ): Promise<number> {
    const handler = this.branchHandlers()[input.branchId];
    if (!handler) {
      return 0;
    }
    return handler(tx, input);
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
        sourceIds: readonly string[];
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
        return transactions.count;
      },
      'finance.balances': (tx, { userId, balanceInstitutionId }) =>
        this.resetBalances(tx, userId, balanceInstitutionId),
      'finance.cards': async (tx, { userId }) => {
        const cards = await tx.finCard.deleteMany({ where: { userId } });
        return cards.count;
      },
      'finance.accounts': async (tx, { userId }) => {
        const accounts = await tx.finAccount.deleteMany({ where: { userId } });
        return accounts.count;
      },
      'finance.institutions': (tx, { userId, sourceIds }) =>
        this.wipeInstitutions(tx, userId, sourceIds),
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
        return this.prisma.finTransaction.count({ where: { userId } });
      case 'finance.balances':
        return (
          (await this.prisma.finAccount.count({ where: { userId } })) +
          (await this.prisma.finCardBalance.count({
            where: { card: { userId } },
          }))
        );
      case 'finance.cards':
        return this.prisma.finCard.count({ where: { userId } });
      case 'finance.accounts':
        return this.prisma.finAccount.count({ where: { userId } });
      case 'finance.institutions':
        return this.prisma.finInstitution.count({
          where: { userId, isSystem: false },
        });
      default:
        return 0;
    }
  }

  private findSourceIds(userId: string): Promise<Array<{ id: string }>> {
    return this.prisma.finEmailSource.findMany({
      where: { userId },
      select: { id: true },
    });
  }

  /**
   * Mail sources whose sync job must stop: the ones this wipe deletes. An
   * unrelated branch must not cancel a sync the user still needs.
   */
  private async affectedSourceIds(
    userId: string,
    branchIds: readonly string[],
  ): Promise<string[]> {
    if (branchIds.includes('finance.emailConnections')) {
      return (await this.findSourceIds(userId)).map((source) => source.id);
    }
    if (!branchIds.includes('finance.institutions')) {
      return [];
    }
    const sources = await this.prisma.finEmailSource.findMany({
      where: {
        userId,
        institution: { isSystem: false },
      },
      select: { id: true },
    });
    return sources.map((source) => source.id);
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
    if (
      branchIds.includes('finance.accounts') ||
      branchIds.includes('finance.cards') ||
      branchIds.includes('finance.institutions')
    ) {
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

  private async cancelGmailSyncJobs(sourceIds: readonly string[]) {
    if (!this.gmailSyncQueue || sourceIds.length === 0) {
      return;
    }
    for (const sourceId of sourceIds) {
      try {
        await this.gmailSyncQueue.remove(gmailSyncJobId(sourceId));
      } catch (error) {
        this.logger.warn(
          `Failed to cancel Gmail sync job for source ${sourceId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
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
    sourceIds: readonly string[],
  ): Promise<number> {
    const institutions = await tx.finInstitution.findMany({
      where: { userId, isSystem: false },
      select: { id: true },
    });
    const institutionIds = institutions.map((institution) => institution.id);
    await tx.finLoan.deleteMany({
      where: { userId, institutionId: { in: institutionIds } },
    });
    const sourceIdList = [...sourceIds];
    await tx.finEmailMessage.deleteMany({
      where: { sourceId: { in: sourceIdList } },
    });
    await tx.finEmailSyncLog.deleteMany({
      where: { sourceId: { in: sourceIdList } },
    });
    const deleted = await tx.finInstitution.deleteMany({
      where: { userId, isSystem: false },
    });
    return deleted.count;
  }
}
