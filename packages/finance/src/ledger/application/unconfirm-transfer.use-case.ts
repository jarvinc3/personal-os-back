import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class UnconfirmTransferUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async execute(userId: string, legId: string): Promise<void> {
    const leg = await this.repo.findTransactionById(legId, userId);
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
