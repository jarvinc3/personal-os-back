import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { assertRestored } from '../../shared/application/assert-restored';
import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';

type AccountDetailRow = NonNullable<
  Awaited<ReturnType<CatalogAccountRepository['findAccountById']>>
>;

/** Account lifecycle: purge the ledger, protect the cash anchor and restore. */
@Injectable()
export class CatalogAccountLifecycle {
  constructor(
    private readonly repo: CatalogAccountRepository,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
    private readonly userBaseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async deleteAccount(userId: string, id: string) {
    const existing = await this.repo.findAccountById(id, userId);
    if (!existing) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    await this.assertCashAccountDeletable(userId, existing);
    const purged = await this.purgeLedger.forAccount(userId, id);
    const removed = await this.repo.deleteAccount({
      userId,
      id,
      movements: purged.rows,
    });
    if (removed.count === 0) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    return { success: true };
  }

  async restoreAccount(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreAccount(userId, id, now);
    assertRestored(restored, 'Cuenta no encontrada');
    return { success: true };
  }

  /**
   * The base-currency "Efectivo" account is the user's anchor: it can be
   * deactivated but never hard-deleted (decision approved on 2026-10-15).
   */
  private async assertCashAccountDeletable(
    userId: string,
    account: Pick<AccountDetailRow, 'type' | 'currency'>,
  ) {
    if (account.type !== CASH_ACCOUNT_TYPE) {
      return;
    }
    const baseCurrency = await this.userBaseCurrency.execute(userId);
    if (normalizeCurrencyCode(account.currency) === baseCurrency) {
      throw new BadRequestException(
        'La cuenta Efectivo de la moneda base no se puede borrar; desactívala',
      );
    }
  }
}
