import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LEDGER_REVERSAL_REPOSITORY,
  LEDGER_QUERY_REPOSITORY,
} from '../../shared/application/tokens';
import {
  TRANSFER_NOT_COMPLETED,
  TRANSFER_NOT_COMPLETED_MESSAGE,
} from '../../shared/domain/transfer';
import type { LedgerReversalRepositoryPort } from './ports/ledger-reversal.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

@Injectable()
export class ReverseTransferUseCase {
  constructor(
    @Inject(LEDGER_REVERSAL_REPOSITORY)
    private readonly repo: LedgerReversalRepositoryPort,
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly query: LedgerQueryRepositoryPort,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async execute(userId: string, legId: string): Promise<void> {
    const leg = await this.query.findTransactionById(legId, userId);
    if (!leg) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (!leg.transferGroupId) {
      throw new BadRequestException('No es una transferencia');
    }

    const legs = await this.query.findTransactionsByTransferGroupId(
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
    void this.relay.wake();
  }
}
