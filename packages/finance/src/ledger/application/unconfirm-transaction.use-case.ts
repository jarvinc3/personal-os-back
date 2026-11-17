import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import {
  TRANSACTION_EDITABILITY,
  TRANSACTION_IMMUTABLE,
  TRANSACTION_IMMUTABLE_MESSAGE,
  transactionEditPolicy,
} from '../../shared/domain/transaction-edit-policy';
import {
  TRANSACTION_LINKED,
  TRANSACTION_LINK_KIND,
  transactionLinkedMessage,
} from '../../shared/domain/transaction-links';
import type { FinTransactionStatusValue } from '../../shared/domain/transaction-status';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class UnconfirmTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async execute(userId: string, id: string) {
    const tx = await this.repo.findTransactionById(id, userId);
    if (!tx) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (tx.transferGroupId) {
      throw new ConflictException({
        code: TRANSACTION_LINKED,
        message: transactionLinkedMessage(TRANSACTION_LINK_KIND.TRANSFER),
      });
    }

    const editability = transactionEditPolicy(
      tx.status as FinTransactionStatusValue,
    ).editable;
    if (editability === TRANSACTION_EDITABILITY.NOTES) {
      throw new ConflictException({
        code: TRANSACTION_IMMUTABLE,
        message: TRANSACTION_IMMUTABLE_MESSAGE,
      });
    }

    if (editability === TRANSACTION_EDITABILITY.METADATA) {
      const linkKind = await this.repo.findPlanningLinkKind(id, userId);
      if (linkKind) {
        throw new ConflictException({
          code: TRANSACTION_LINKED,
          message: transactionLinkedMessage(linkKind),
        });
      }
    }

    const updated = await this.repo.unconfirmTransaction(userId, id);
    if (!updated) {
      throw new NotFoundException('Transacción no encontrada');
    }
    void this.relay.wake();
    return mapLedgerTransaction(updated.transaction);
  }
}
