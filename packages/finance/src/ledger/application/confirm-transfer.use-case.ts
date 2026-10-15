import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class ConfirmTransferUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, legId: string): Promise<void> {
    const leg = await this.repo.findTransactionById(legId, userId);
    if (!leg) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (!leg.transferGroupId) {
      throw new BadRequestException('No es una transferencia');
    }

    await this.repo.confirmTransactionsByTransferGroupId(
      userId,
      leg.transferGroupId,
    );
    void this.outboxDispatcher.processBatch();
  }
}
