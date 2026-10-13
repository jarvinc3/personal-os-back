import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { roundMoney } from '../../shared/domain/money';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateReceivablePaymentDto } from '../presentation/dto/create-receivable-payment.dto';
import { mapReceivablePayment } from './planning-mappers';

export const RECEIVABLE_EXCESS_UNRESOLVED = 'RECEIVABLE_EXCESS_UNRESOLVED';
export const RECEIVABLE_NOT_FOUND = 'RECEIVABLE_NOT_FOUND';
export const RECEIVABLE_NOT_OPEN = 'RECEIVABLE_NOT_OPEN';

/**
 * Collecting a debt records the real amount received. What is left over the
 * outstanding amount is resolved by `excessHandling`.
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
      throw new NotFoundException({
        code: RECEIVABLE_NOT_FOUND,
        message: 'No encontramos el cobro.',
      });
    }
    await this.ownership.assertAccountOwned(userId, dto.accountId);

    const outstanding = roundMoney(
      Number(receivable.amount) - Number(receivable.paidAmount),
    );
    const appliedAmount = roundMoney(Math.min(dto.amount, outstanding));
    const excess = roundMoney(dto.amount - appliedAmount);
    if (excess > 0 && !dto.excessHandling) {
      throw new UnprocessableEntityException({
        code: RECEIVABLE_EXCESS_UNRESOLVED,
        message: `El pago supera lo pendiente por ${excess}. Elige qué hacer con la diferencia.`,
        details: { outstanding, excess },
      });
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : now;
    const extraIncome = excess > 0 && dto.excessHandling === 'EXTRA_INCOME';
    const creditedAmount = extraIncome ? appliedAmount : dto.amount;
    let appliedMovementId = dto.transactionId;
    if (!appliedMovementId) {
      const appliedMovement = await this.createTransaction.execute(userId, {
        accountId: dto.accountId,
        type: 'CREDIT',
        amount: creditedAmount,
        currency: receivable.currency,
        transactionDate: paidAt.toISOString(),
        description: `Cobro: ${receivable.debtorName}`,
      });
      appliedMovementId = appliedMovement.id;
    }
    if (extraIncome) {
      const categoryId = await this.repo.findExtraIncomeCategoryId();
      await this.createTransaction.execute(userId, {
        accountId: dto.accountId,
        type: 'CREDIT',
        amount: excess,
        currency: receivable.currency,
        transactionDate: paidAt.toISOString(),
        description: `Ingreso extra: ${receivable.debtorName}`,
        ...(categoryId ? { categoryId } : {}),
      });
    }

    const payment = await this.repo.createReceivablePayment(receivableId, {
      amount: dto.amount,
      appliedAmount,
      excessAmount: excess,
      ...(dto.excessHandling ? { excessHandling: dto.excessHandling } : {}),
      paidAt,
      accountId: dto.accountId,
      transactionId: appliedMovementId,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });

    if (excess > 0 && dto.excessHandling === 'CREDIT_BALANCE') {
      await this.repo.addReceivableCreditBalance(receivableId, excess);
    }
    if (
      excess > 0 &&
      dto.excessHandling === 'APPLY_TO_RECEIVABLE' &&
      dto.targetReceivableId
    ) {
      const target = await this.repo.findReceivable(
        userId,
        dto.targetReceivableId,
      );
      if (!target) {
        throw new NotFoundException({
          code: RECEIVABLE_NOT_FOUND,
          message: 'No encontramos el cobro destino.',
        });
      }
      if (
        target.status === 'PAID' ||
        target.status === 'CANCELLED' ||
        target.status === 'WRITTEN_OFF'
      ) {
        throw new ConflictException({
          code: RECEIVABLE_NOT_OPEN,
          message: 'El cobro destino ya está cerrado.',
        });
      }
      await this.repo.createReceivablePayment(dto.targetReceivableId, {
        amount: excess,
        appliedAmount: excess,
        excessAmount: 0,
        paidAt,
        accountId: dto.accountId,
        transactionId: null,
      });
    }

    return mapReceivablePayment(payment);
  }
}
