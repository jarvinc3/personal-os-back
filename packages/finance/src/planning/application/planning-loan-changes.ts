import type { Prisma } from '@personal-os/database';
import type { CreateLoanDto } from '../presentation/dto/create-loan.dto';
import type { UpdateLoanDto } from '../presentation/dto/update-loan.dto';

export type LoanCreateFields = Omit<
  Prisma.FinLoanUncheckedCreateInput,
  'userId'
>;

export type LoanUpdateFields = Prisma.FinLoanUncheckedUpdateManyInput;

type LoanCreateTerms = Pick<
  LoanCreateFields,
  | 'interestRate'
  | 'rateType'
  | 'insuranceAmount'
  | 'prepaymentPenaltyPct'
  | 'disbursementDate'
  | 'notes'
>;

type LoanEnvelope = {
  currency: string;
  loanName: string | null;
  disbursementAccountId: string | null;
  disbursementTransactionId: string | null;
};

/** Required terms of a new loan, plus the disbursement link when it exists. */
export function loanCreateFields(
  dto: CreateLoanDto,
  envelope: LoanEnvelope,
): LoanCreateFields {
  return {
    name: envelope.loanName,
    lenderName: dto.lenderName,
    institutionId: dto.institutionId,
    accountId: dto.accountId,
    disbursementAccountId: envelope.disbursementAccountId ?? undefined,
    disbursementTransactionId: envelope.disbursementTransactionId ?? undefined,
    originalAmount: dto.originalAmount,
    currentBalance: dto.currentBalance,
    currency: envelope.currency,
    installmentAmount: dto.installmentAmount,
    installmentFreq: dto.installmentFreq,
    totalInstallments: dto.totalInstallments,
    paidInstallments: dto.paidInstallments ?? 0,
    nextDueDate: new Date(dto.nextDueDate),
    ...loanCreateTerms(dto),
  };
}

/** Optional rate, insurance, disbursement date and notes of a new loan. */
export function loanCreateTerms(dto: CreateLoanDto): LoanCreateTerms {
  const fields: LoanCreateTerms = {};
  if (dto.interestRate !== undefined) {
    fields.interestRate = dto.interestRate;
  }
  if (dto.rateType) {
    fields.rateType = dto.rateType;
  }
  if (dto.insuranceAmount !== undefined) {
    fields.insuranceAmount = dto.insuranceAmount;
  }
  if (dto.prepaymentPenaltyPct !== undefined) {
    fields.prepaymentPenaltyPct = dto.prepaymentPenaltyPct;
  }
  if (dto.disbursementDate) {
    fields.disbursementDate = new Date(dto.disbursementDate);
  }
  if (dto.notes !== undefined) {
    fields.notes = dto.notes;
  }
  return fields;
}

/** Name, lender, assignment and rate fields that a PATCH may change. */
export function loanTermsFields(dto: UpdateLoanDto): LoanUpdateFields {
  const fields: LoanUpdateFields = {};
  if (dto.name !== undefined) {
    fields.name = dto.name?.trim() || null;
  }
  if (dto.lenderName) {
    fields.lenderName = dto.lenderName;
  }
  if (dto.institutionId !== undefined) {
    fields.institutionId = dto.institutionId;
  }
  if (dto.accountId !== undefined) {
    fields.accountId = dto.accountId;
  }
  if (dto.nextDueDate) {
    fields.nextDueDate = new Date(dto.nextDueDate);
  }
  if (dto.currency) {
    fields.currency = dto.currency;
  }
  if (dto.interestRate !== undefined) {
    fields.interestRate = dto.interestRate;
  }
  if (dto.rateType) {
    fields.rateType = dto.rateType;
  }
  if (dto.notes !== undefined) {
    fields.notes = dto.notes;
  }
  return fields;
}

/** Amount, installment and activity fields that a PATCH may change. */
export function loanScheduleFields(dto: UpdateLoanDto): LoanUpdateFields {
  const fields: LoanUpdateFields = {};
  if (dto.currentBalance !== undefined) {
    fields.currentBalance = dto.currentBalance;
  }
  if (dto.installmentAmount !== undefined) {
    fields.installmentAmount = dto.installmentAmount;
  }
  if (dto.installmentFreq) {
    fields.installmentFreq = dto.installmentFreq;
  }
  if (dto.totalInstallments !== undefined) {
    fields.totalInstallments = dto.totalInstallments;
  }
  if (dto.paidInstallments !== undefined) {
    fields.paidInstallments = dto.paidInstallments;
  }
  if (dto.isActive !== undefined) {
    fields.isActive = dto.isActive;
  }
  if (dto.insuranceAmount !== undefined) {
    fields.insuranceAmount = dto.insuranceAmount;
  }
  if (dto.prepaymentPenaltyPct !== undefined) {
    fields.prepaymentPenaltyPct = dto.prepaymentPenaltyPct;
  }
  if (dto.disbursementDate) {
    fields.disbursementDate = new Date(dto.disbursementDate);
  }
  return fields;
}
