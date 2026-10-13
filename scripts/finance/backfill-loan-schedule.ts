import { createScriptPrismaClient } from '@personal-os/database';
import {
  rebuildLoanInstallments,
  type LoanInstallmentFrequency,
} from '../../packages/finance/src/planning/domain/loan-installment-rebuild';
import { roundMoney } from '../../packages/finance/src/shared/domain/money';

const INSTALLMENT_STATUS_PAID = 'PAID';
const INSTALLMENT_STATUS_PENDING = 'PENDING';

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
    const rebuilt = rebuildLoanInstallments(
      {
        originalAmount: Number(loan.originalAmount),
        installmentAmount: Number(loan.installmentAmount),
        installmentFreq: loan.installmentFreq as LoanInstallmentFrequency,
        interestRate:
          loan.interestRate === null ? null : Number(loan.interestRate),
        insuranceAmount:
          loan.insuranceAmount === null ? null : Number(loan.insuranceAmount),
      },
      loan.installments.map((installment) => ({
        id: installment.id,
        installmentNo: installment.installmentNo,
        paidAt: installment.paidAt,
      })),
    );
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
