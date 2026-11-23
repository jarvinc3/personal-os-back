import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { assertRestored } from '../../shared/application/assert-restored';
import { roundMoney } from '../../shared/domain/money';
import { PlanningLoanRepository } from '../infrastructure/planning-loan.repository';
import type { CreateLoanDto } from '../presentation/dto/create-loan.dto';
import type { UpdateLoanDto } from '../presentation/dto/update-loan.dto';
import {
  loanCreateFields,
  loanScheduleFields,
  loanTermsFields,
} from './planning-loan-changes';
import { mapLoan, mapLoanInstallment } from './planning-mappers';
import { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

type LoanRow = NonNullable<
  Awaited<ReturnType<PlanningLoanRepository['findLoan']>>
>;

type PlanningLoansDeps = {
  repo: PlanningLoanRepository;
  ownership: FinanceOwnershipService;
  syncInstallments: SyncLoanInstallmentsUseCase;
  adjustBalance: AdjustBalanceUseCase;
  deleteTransaction: DeleteTransactionUseCase;
};

/** Loans of a user: disbursement, installments and schedule sync. */
export class PlanningLoans {
  private readonly repo: PlanningLoanRepository;
  private readonly ownership: FinanceOwnershipService;
  private readonly syncInstallments: SyncLoanInstallmentsUseCase;
  private readonly adjustBalance: AdjustBalanceUseCase;
  private readonly deleteTransaction: DeleteTransactionUseCase;

  constructor({
    repo,
    ownership,
    syncInstallments,
    adjustBalance,
    deleteTransaction,
  }: PlanningLoansDeps) {
    this.repo = repo;
    this.ownership = ownership;
    this.syncInstallments = syncInstallments;
    this.adjustBalance = adjustBalance;
    this.deleteTransaction = deleteTransaction;
  }

  async listLoans(userId: string) {
    const rows = await this.repo.listLoans(userId);
    return rows.map(mapLoan);
  }

  async listLoansPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listLoansPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.nextDueDate.toISOString(),
    );
    return { ...page, items: page.items.map(mapLoan) };
  }

  async getLoan(userId: string, id: string) {
    const row = await this.repo.findLoan(userId, id);
    if (!row) {
      throw new NotFoundException('Préstamo no encontrado');
    }
    return mapLoan(row);
  }

  async lookupLoans(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findLoansByIds(userId, ids);
    return new Map(rows.map((row) => [row.id, mapLoan(row)]));
  }

  async listLoanInstallments(userId: string, id: string) {
    const loan = await this.repo.findLoan(userId, id);
    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado');
    }
    const rows = await this.repo.listInstallments(id);
    return rows.map(mapLoanInstallment);
  }

  async listLoanInstallmentsPage(
    userId: string,
    id: string,
    query: CursorQueryDto,
  ) {
    const loan = await this.repo.findLoan(userId, id);
    if (!loan) {
      throw new NotFoundException('Préstamo no encontrado');
    }
    const rows = await this.repo.listInstallmentsPage(id, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.dueDate.toISOString(),
    );
    return { ...page, items: page.items.map(mapLoanInstallment) };
  }

  async createLoan(userId: string, dto: CreateLoanDto, now: Date) {
    if (dto.institutionId) {
      await this.ownership.assertInstitutionAcceptsBankProducts(
        userId,
        dto.institutionId,
      );
    }
    if (dto.accountId) {
      await this.ownership.assertLoanAccountAlignment({
        userId,
        accountId: dto.accountId,
        institutionId: dto.institutionId,
      });
    }
    const currency = dto.currency ?? 'DOP';
    const loanName = dto.name?.trim() || null;
    const disbursementAccountId = dto.disbursementAccountId ?? null;
    const disbursementTransactionId = disbursementAccountId
      ? await this.disburseLoan({
          userId,
          accountId: disbursementAccountId,
          currency,
          amount: dto.originalAmount,
          label: loanName ?? dto.lenderName,
          transactionDate: dto.disbursementDate
            ? new Date(dto.disbursementDate)
            : now,
        })
      : null;

    let created: Awaited<ReturnType<PlanningLoanRepository['createLoan']>>;
    try {
      created = await this.repo.createLoan(
        userId,
        loanCreateFields(dto, {
          currency,
          loanName,
          disbursementAccountId,
          disbursementTransactionId,
        }),
      );
    } catch (error) {
      if (disbursementTransactionId) {
        await this.deleteTransaction.execute(userId, disbursementTransactionId);
      }
      throw error;
    }
    await this.syncInstallments.execute(created, now);
    return mapLoan(created);
  }

  // Public signature fixed by the controller and the tests; the partial payload
  // comes from the changes file.
  // eslint-disable-next-line max-params
  async updateLoan(userId: string, id: string, dto: UpdateLoanDto, now: Date) {
    const existing = await this.repo.findLoan(userId, id);
    if (!existing) {
      throw new NotFoundException('Préstamo no encontrado');
    }
    await this.assertLoanAssignment(userId, existing, dto);
    this.assertLoanUpdateAllowed(existing, dto);
    const updated = await this.repo.updateLoan(userId, id, {
      ...loanTermsFields(dto),
      ...loanScheduleFields(dto),
    });
    if (!updated) {
      throw new NotFoundException('Préstamo no encontrado');
    }
    await this.syncInstallments.execute(updated, now);
    return mapLoan(updated);
  }

  async deactivateLoan(userId: string, id: string) {
    const updated = await this.repo.updateLoan(userId, id, { isActive: false });
    if (!updated) {
      throw new NotFoundException('Préstamo no encontrado');
    }
    return { success: true };
  }

  async deleteLoan(userId: string, id: string) {
    const deleted = await this.repo.deleteLoan(userId, id);
    if (deleted.count === 0) {
      throw new NotFoundException('Préstamo no encontrado');
    }
    return { success: true };
  }

  async restoreLoan(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreLoan(userId, id, now);
    assertRestored(restored, 'Loan not found');
    return { success: true };
  }

  private async assertLoanAssignment(
    userId: string,
    existing: LoanRow,
    dto: UpdateLoanDto,
  ): Promise<void> {
    const nextInstitutionId =
      dto.institutionId !== undefined
        ? dto.institutionId
        : existing.institutionId;
    const nextAccountId =
      dto.accountId !== undefined ? dto.accountId : existing.accountId;
    if (dto.institutionId) {
      await this.ownership.assertInstitutionAcceptsBankProducts(
        userId,
        dto.institutionId,
      );
    }
    if (nextAccountId) {
      await this.ownership.assertLoanAccountAlignment({
        userId,
        accountId: nextAccountId,
        institutionId: nextInstitutionId,
      });
    }
  }

  private assertLoanUpdateAllowed(existing: LoanRow, dto: UpdateLoanDto): void {
    const nextOriginalAmount = Number(existing.originalAmount);
    const nextCurrentBalance =
      dto.currentBalance !== undefined
        ? dto.currentBalance
        : Number(existing.currentBalance);
    if (nextCurrentBalance > nextOriginalAmount) {
      throw new BadRequestException(
        'currentBalance no puede superar originalAmount',
      );
    }
    const nextTotalInstallments =
      dto.totalInstallments !== undefined
        ? dto.totalInstallments
        : existing.totalInstallments;
    const nextPaidInstallments =
      dto.paidInstallments !== undefined
        ? dto.paidInstallments
        : existing.paidInstallments;
    if (nextPaidInstallments > nextTotalInstallments) {
      throw new BadRequestException(
        'paidInstallments no puede superar totalInstallments',
      );
    }
  }

  /**
   * Credits the disbursed principal to the chosen account as an adjustment, so
   * the account grows without counting as monthly income.
   */
  private async disburseLoan(input: {
    userId: string;
    accountId: string;
    currency: string;
    amount: number;
    label: string;
    transactionDate: Date;
  }): Promise<string> {
    const account = await this.assertDisbursementAccount(
      input.userId,
      input.accountId,
      input.currency,
    );
    const adjusted = await this.adjustBalance.execute(input.userId, {
      accountId: account.id,
      balance: roundMoney(Number(account.balance) + input.amount),
      description: `Desembolso de préstamo · ${input.label}`,
      transactionDate: input.transactionDate,
    });
    if (!adjusted.transaction) {
      throw new BadRequestException('No se pudo registrar el desembolso');
    }
    return adjusted.transaction.id;
  }

  private async assertDisbursementAccount(
    userId: string,
    accountId: string,
    currency: string,
  ) {
    const account = await this.ownership.assertAccountOwned(userId, accountId);
    if (!account.isActive) {
      throw new BadRequestException('La cuenta del desembolso está archivada');
    }
    if (account.currency !== currency) {
      throw new BadRequestException(
        'La cuenta del desembolso debe estar en la moneda del préstamo',
      );
    }
    return account;
  }
}
