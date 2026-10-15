import { Injectable } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { CASH_INSTITUTION_NAME } from '../../shared/domain/cash';
import { CatalogRepository } from '../infrastructure/catalog.repository';

/**
 * Guarantees the user has the system "Efectivo" institution (pendiente 16).
 *
 * Idempotent: an existing institution short-circuits with a single query. When
 * it is missing, the institution is created, institution-less CASH accounts are
 * moved into it, and a base-currency "Efectivo" account is added so a new user
 * sees cash without creating anything. The read of the ensured id belongs to the
 * caller, through the repository query (CQS).
 */
@Injectable()
export class EnsureCashInstitutionUseCase {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async execute(userId: string): Promise<void> {
    const existing = await this.repo.findSystemCashInstitution(userId);
    if (existing) {
      return;
    }
    await this.provision(userId);
  }

  private async provision(userId: string): Promise<void> {
    const institution = await this.createInstitution(userId);
    await this.repo.assignInstitutionlessCashAccounts(userId, institution.id);
    await this.ensureDefaultAccount(userId, institution.id);
  }

  private async createInstitution(userId: string) {
    try {
      return await this.repo.createSystemCashInstitution(userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.repo.findSystemCashInstitution(userId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async ensureDefaultAccount(userId: string, institutionId: string) {
    const cashAccount = await this.repo.findFirstCashAccount(userId);
    if (cashAccount) {
      return;
    }
    const currency = await this.baseCurrency.execute(userId);
    await this.repo.createCashAccount(userId, {
      institutionId,
      name: CASH_INSTITUTION_NAME,
      currency,
    });
  }
}
