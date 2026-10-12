import { Injectable, NotFoundException } from '@nestjs/common';
import { roundMoney } from '../../shared/domain/money';
import { PlanningRepository } from '../infrastructure/planning.repository';
import { RECEIVABLE_NOT_FOUND } from './record-receivable-payment.use-case';

export type WriteOffReceivableCommand = {
  amount?: number;
  reason?: string;
};

/** Closes an uncollectible receivable; it never moves money. */
@Injectable()
export class WriteOffReceivableUseCase {
  constructor(private readonly repo: PlanningRepository) {}

  async execute(
    userId: string,
    receivableId: string,
    command: WriteOffReceivableCommand,
    now: Date,
  ): Promise<void> {
    const receivable = await this.repo.findReceivable(userId, receivableId);
    if (!receivable) {
      throw new NotFoundException({
        code: RECEIVABLE_NOT_FOUND,
        message: 'No encontramos el cobro.',
      });
    }
    const outstanding = roundMoney(
      Number(receivable.amount) - Number(receivable.paidAmount),
    );
    await this.repo.writeOffReceivable(receivableId, {
      writtenOffAmount: command.amount ?? outstanding,
      writtenOffAt: now,
    });
  }
}
