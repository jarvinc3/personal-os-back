import { createScriptPrismaClient } from '@personal-os/database';

const INSTALLMENT_STATUS_PAID = 'PAID';
const INSTALLMENT_STATUS_PENDING = 'PENDING';
const MONEY_PRECISION = 100;

type LoanRow = {
  id: string;
  userId: string;
  originalAmount: { toString(): string };
  currentBalance: { toString(): string };
  installmentAmount: { toString(): string };
  installmentFreq: string;
  interestRate: { toString(): string } | null;
  insuranceAmount: { toString(): string } | null;
};

type InstallmentRow = {
  id: string;
  installmentNo: number;
  paidAt: Date | null;
};

function roundMoney(value: number): number {
  return Math.round(value * MONEY_PRECISION) / MONEY_PRECISION;
}

function loanPeriodsPerYear(frequency: string): number {
  if (frequency === 'WEEKLY') {
    return 52;
  }
  if (frequency === 'BIWEEKLY') {
    return 26;
  }
  return 12;
}

/**
 * Rebuilds the French breakdown of every instalment from the original
 * principal, and the balance from the paid principal. The migration only set
 * `principal = 0`, so without this the balance comes out as the original
 * amount. Idempotent; run with `--dry-run` first.
 */
type RebuiltInstallment = {
  id: string;
  installmentNo: number;
  principal: number;
  interest: number;
  insurance: number;
  amount: number;
  paidAt: Date | null;
};

function rebuildInstallments(
  loan: LoanRow,
  installments: readonly InstallmentRow[],
): RebuiltInstallment[] {
  const rate =
    loan.interestRate === null
      ? 0
      : Number(loan.interestRate) / loanPeriodsPerYear(loan.installmentFreq);
  const installmentAmount = Number(loan.installmentAmount);
  const insurance =
    loan.insuranceAmount === null ? 0 : Number(loan.insuranceAmount);
  const ordered = [...installments].sort(
    (left, right) => left.installmentNo - right.installmentNo,
  );

  let balance = Number(loan.originalAmount);
  return ordered.map((installment, index) => {
    const isLast = index === ordered.length - 1;
    const interest = roundMoney(Math.max(0, balance * rate));
    const principal = isLast
      ? roundMoney(balance)
      : roundMoney(
          Math.max(0, Math.min(installmentAmount - interest, balance)),
        );
    balance = roundMoney(balance - principal);
    return {
      id: installment.id,
      installmentNo: installment.installmentNo,
      principal,
      interest,
      insurance,
      amount: roundMoney(principal + interest + insurance),
      paidAt: installment.paidAt,
    };
  });
}

async function ensureBackupTable(
  prisma: ReturnType<typeof createScriptPrismaClient>,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "fin_loan_balance_backup" (
      "loan_id" TEXT NOT NULL,
      "old_balance" DECIMAL(15, 2) NOT NULL,
      "new_balance" DECIMAL(15, 2) NOT NULL,
      "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
      CONSTRAINT "fin_loan_balance_backup_pkey" PRIMARY KEY ("loan_id")
    )
  `);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();
  if (!dryRun) {
    await ensureBackupTable(prisma);
  }

  const loans = await prisma.finLoan.findMany({
    include: { installments: true },
  });

  for (const loan of loans) {
    if (loan.installments.length === 0) {
      continue;
    }
    const rebuilt = rebuildInstallments(loan as LoanRow, loan.installments);
    const paidPrincipal = rebuilt
      .filter((installment) => installment.paidAt !== null)
      .reduce((sum, installment) => sum + installment.principal, 0);
    const newBalance = roundMoney(Number(loan.originalAmount) - paidPrincipal);
    const oldBalance = roundMoney(Number(loan.currentBalance));
    const breakdownChanged = rebuilt.some((installment) => {
      const stored = loan.installments.find((row) => row.id === installment.id);
      if (!stored) {
        return false;
      }
      return (
        roundMoney(Number(stored.principal)) !== installment.principal ||
        roundMoney(Number(stored.interest)) !== installment.interest ||
        roundMoney(Number(stored.insurance)) !== installment.insurance
      );
    });
    if (!breakdownChanged && newBalance === oldBalance) {
      continue;
    }

    process.stdout.write(
      `${loan.id}: balance ${oldBalance} -> ${newBalance}\n`,
    );
    for (const installment of rebuilt) {
      process.stdout.write(
        `  cuota ${installment.installmentNo}: capital ${installment.principal} interes ${installment.interest} seguro ${installment.insurance}\n`,
      );
    }
    if (dryRun) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "fin_loan_balance_backup" ("loan_id", "old_balance", "new_balance", "created_at")
        VALUES (${loan.id}, ${oldBalance}, ${newBalance}, now())
        ON CONFLICT ("loan_id")
        DO UPDATE SET "old_balance" = EXCLUDED."old_balance",
                      "new_balance" = EXCLUDED."new_balance",
                      "created_at" = now()
      `;
      for (const installment of rebuilt) {
        const paid = installment.paidAt !== null;
        await tx.finLoanInstallment.update({
          where: { id: installment.id },
          data: {
            principal: installment.principal,
            interest: installment.interest,
            insurance: installment.insurance,
            amount: installment.amount,
            status: paid ? INSTALLMENT_STATUS_PAID : INSTALLMENT_STATUS_PENDING,
            ...(paid ? { paidAmount: installment.amount } : {}),
          },
        });
      }
      await tx.finLoan.update({
        where: { id: loan.id },
        data: { currentBalance: newBalance },
      });
    });
  }

  await prisma.$disconnect();
}

void main();
