import { Inject, Injectable } from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

/** Clears the "possible duplicate" flag after the user says it is not one. */
@Injectable()
export class MarkNotDuplicateUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
  ) {}

  async execute(userId: string, id: string): Promise<void> {
    await this.repo.clearPossibleDuplicate(userId, id);
  }
}
