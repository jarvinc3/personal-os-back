import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { LogoService } from '@personal-os/logos';
import type { DataBranchDescriptor } from '@personal-os/users';
import { FINANCE_DATA_BRANCHES } from '../domain/finance-data-branches';
import { financeWipeBranches } from './finance-wipe-branches';
import type {
  FinanceWipeBranchInput,
  FinanceWipeTx,
} from './finance-wipe-branch';

/**
 * Bulk finance wipe by data branch. Never reuses the per-instrument purge: that
 * would emit one outbox event per transaction and flood the listeners.
 */
@Injectable()
export class WipeFinanceUserDataUseCase {
  private readonly branches = financeWipeBranches();

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

  private applyBranch(
    tx: FinanceWipeTx,
    input: FinanceWipeBranchInput & { branchId: string },
  ): Promise<number> {
    const branch = this.branches[input.branchId];
    if (!branch) {
      return Promise.resolve(0);
    }
    return branch.apply(tx, input);
  }

  private countBranch(userId: string, branchId: string): Promise<number> {
    const branch = this.branches[branchId];
    if (!branch) {
      return Promise.resolve(0);
    }
    return branch.count(this.prisma, userId);
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
}
