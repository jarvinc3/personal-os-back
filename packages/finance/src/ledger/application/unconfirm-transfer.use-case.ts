import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LEDGER_STATUS_REPOSITORY,
  LEDGER_QUERY_REPOSITORY,
} from '../../shared/application/tokens';
import type { LedgerStatusRepositoryPort } from './ports/ledger-status.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

@Injectable()
export class UnconfirmTransferUseCase {
  constructor(
    @Inject(LEDGER_STATUS_REPOSITORY)
    private readonly repo: LedgerStatusRepositoryPort,
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

    await this.repo.unconfirmTransactionsByTransferGroupId(
      userId,
      leg.transferGroupId,
    );
    void this.relay.wake();
  }
}
