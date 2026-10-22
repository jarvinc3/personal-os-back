import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import {
  TRANSFER_NOT_COMPLETED,
  TRANSFER_NOT_COMPLETED_MESSAGE,
} from '../../shared/domain/transfer';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class ReverseTransferUseCase {
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

    const legs = await this.repo.findTransactionsByTransferGroupId(
      leg.transferGroupId,
      userId,
    );
    const reversible = legs.every(
      (item) => item.status === 'CONFIRMED' || item.status === 'REVERSED',
    );
    if (!reversible) {
      throw new ConflictException({
        code: TRANSFER_NOT_COMPLETED,
        message: TRANSFER_NOT_COMPLETED_MESSAGE,
      });
    }
    if (legs.every((item) => item.status === 'REVERSED')) {
      return;
    }

    await this.repo.reverseTransactionsByTransferGroupId(
      userId,
      leg.transferGroupId,
    );
    void this.outboxDispatcher.processBatch();
  }
}
