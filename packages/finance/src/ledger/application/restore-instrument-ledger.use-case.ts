import { Inject, Injectable } from '@nestjs/common';
import { LEDGER_DELETION_REPOSITORY } from '../../shared/application/tokens';
import type { StoredMovement } from '../../shared/domain/deletion-snapshot';
import type { LedgerDeletionRepositoryPort } from './ports/ledger-deletion.repository.port';

/** Applies again the balance and budget effect of movements a delete reversed. */
@Injectable()
export class RestoreInstrumentLedgerUseCase {
  constructor(
    @Inject(LEDGER_DELETION_REPOSITORY)
    private readonly repo: LedgerDeletionRepositoryPort,
  ) {}

  execute(userId: string, movements: readonly StoredMovement[]) {
    return this.repo.restoreLedgerTransactions(userId, movements);
  }
}
