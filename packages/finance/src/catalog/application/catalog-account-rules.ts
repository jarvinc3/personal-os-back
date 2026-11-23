import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnsureCashInstitutionUseCase } from './ensure-cash-institution.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import { CatalogCashRepository } from '../infrastructure/catalog-cash.repository';

type InstitutionResolution = {
  userId: string;
  type: string;
  requestedInstitutionId: string | undefined;
  fallbackInstitutionId?: string | null;
};

/** Institution rules shared by the account reads and mutations. */
@Injectable()
export class CatalogAccountRules {
  constructor(
    private readonly cashRepo: CatalogCashRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly ensureCashInstitution: EnsureCashInstitutionUseCase,
  ) {}

  ensureCash(userId: string): Promise<void> {
    return this.ensureCashInstitution.execute(userId);
  }

  async resolveInstitution(params: InstitutionResolution): Promise<string> {
    if (params.type === CASH_ACCOUNT_TYPE) {
      return this.resolveCashInstitutionId({
        userId: params.userId,
        requestedInstitutionId: params.requestedInstitutionId,
      });
    }
    const institutionId =
      params.requestedInstitutionId ?? params.fallbackInstitutionId;
    if (!institutionId) {
      throw new BadRequestException(
        'CHECKING, SAVINGS, and INVESTMENT accounts require institutionId',
      );
    }
    await this.ownership.assertInstitutionAcceptsBankProducts(
      params.userId,
      institutionId,
    );
    return institutionId;
  }

  assertInstitutionChangeAllowed(input: {
    userId: string;
    accountId: string;
    nextInstitutionId: string;
  }): Promise<void> {
    return this.ownership.assertAccountInstitutionChangeAllowed(input);
  }

  /**
   * Cash only lives in the system "Efectivo". The command ensures it exists;
   * the id is then read through the repository query (CQS).
   */
  private async resolveCashInstitutionId({
    userId,
    requestedInstitutionId,
  }: {
    userId: string;
    requestedInstitutionId: string | undefined;
  }): Promise<string> {
    await this.ensureCashInstitution.execute(userId);
    const cash = await this.cashRepo.findSystemCashInstitution(userId);
    if (!cash) {
      throw new NotFoundException('Efectivo no está disponible');
    }
    if (requestedInstitutionId && requestedInstitutionId !== cash.id) {
      throw new BadRequestException(
        'Las cuentas de efectivo van dentro de Efectivo',
      );
    }
    return cash.id;
  }
}
