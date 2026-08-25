import {
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

/**
 * Deletes a manual transaction (or transfer group). Balance compensation
 * runs inside the repo TX. No domain outbox event is emitted (delete has no
 * notif/AI consumers today).
 */
@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
  ) {}

  async execute(userId: string, id: string) {
    const tx = await this.repo.findTransactionById(id, userId);
    if (!tx) throw new NotFoundException('Manual transaction not found');

    if (tx.transferGroupId) {
      const result = await this.repo.deleteTransactionsByTransferGroupId(
        userId,
        tx.transferGroupId,
      );
      if (result.count === 0) {
        throw new NotFoundException('Manual transaction not found');
      }
      return { success: true };
    }

    const result = await this.repo.deleteTransaction(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Manual transaction not found');
    }
    return { success: true };
  }
}
