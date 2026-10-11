import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateReceivablePaymentDto } from '../presentation/dto/create-receivable-payment.dto';
import { mapReceivablePayment } from './planning-mappers';

/**
 * Collecting a debt is real income: the amount is recorded on the account the
 * money entered, and the receivable balance is the sum of those payments.
 */
@Injectable()
export class RecordReceivablePaymentUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly createTransaction: CreateTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    receivableId: string,
    dto: CreateReceivablePaymentDto,
    now: Date,
  ) {
    const receivable = await this.repo.findReceivable(userId, receivableId);
    if (!receivable) {
      throw new NotFoundException('Receivable not found');
    }
    await this.ownership.assertAccountOwned(userId, dto.accountId);

    const outstanding =
      Number(receivable.amount) - Number(receivable.paidAmount);
    if (dto.amount > outstanding) {
      throw new BadRequestException(
        'Payment cannot exceed the outstanding amount',
      );
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : now;
    const movement = await this.createTransaction.execute(userId, {
      accountId: dto.accountId,
      type: 'CREDIT',
      amount: dto.amount,
      currency: receivable.currency,
      transactionDate: paidAt.toISOString(),
      description: `Cobro: ${receivable.debtorName}`,
    });

    const payment = await this.repo.createReceivablePayment(receivableId, {
      amount: dto.amount,
      paidAt,
      accountId: dto.accountId,
      transactionId: movement.id,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });
    return mapReceivablePayment(payment);
  }
}
