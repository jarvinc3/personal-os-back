import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SyncLoanInstallmentsUseCase } from '../application/sync-loan-installments.use-case';
import { PlanningRepository } from './planning.repository';

/**
 * Materializes the instalment rows of loans created before the schedule
 * existed. Idempotent, so it runs at startup instead of as a migration.
 */
@Injectable()
export class LoanInstallmentsBackfill implements OnModuleInit {
  private readonly logger = new Logger(LoanInstallmentsBackfill.name);

  constructor(
    private readonly repo: PlanningRepository,
    private readonly syncInstallments: SyncLoanInstallmentsUseCase,
  ) {}

  onModuleInit(): void {
    void this.run(new Date()).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Loan instalment backfill failed: ${message}`);
    });
  }

  async run(now: Date): Promise<void> {
    const loans = await this.repo.listLoansForScheduleSync();
    for (const loan of loans) {
      await this.syncInstallments.execute(loan, now);
    }
  }
}
