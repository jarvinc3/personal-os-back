import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { roundMoney } from '../../shared/domain/money';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { ApplyReceivableCreditDto } from '../presentation/dto/apply-receivable-credit.dto';
import {
  RECEIVABLE_NOT_FOUND,
  RECEIVABLE_NOT_OPEN,
} from './record-receivable-payment.use-case';

/** Spends a receivable credit balance on another open receivable. */
@Injectable()
export class ApplyReceivableCreditUseCase {
  constructor(private readonly repo: PlanningRepository) {}

  async execute(
    userId: string,
    sourceReceivableId: string,
    dto: ApplyReceivableCreditDto,
    now: Date,
  ) {
    const source = await this.repo.findReceivable(userId, sourceReceivableId);
    if (!source) {
      throw new NotFoundException({
        code: RECEIVABLE_NOT_FOUND,
        message: 'No encontramos el cobro.',
      });
    }
    const creditBalance = Number(source.creditBalance);
    const amount =
      dto.amount === undefined ? roundMoney(creditBalance) : dto.amount;
    if (creditBalance <= 0 || amount > creditBalance) {
      throw new BadRequestException({
        code: RECEIVABLE_NOT_OPEN,
        message: 'El cobro no tiene saldo a favor suficiente.',
      });
    }

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
      target.status === 'WRITTEN_OFF' ||
      target.id === source.id
    ) {
      throw new ConflictException({
        code: RECEIVABLE_NOT_OPEN,
        message: 'El cobro destino ya está cerrado.',
      });
    }

    await this.repo.applyReceivableCredit({
      sourceReceivableId: source.id,
      targetReceivableId: target.id,
      amount: roundMoney(amount),
      paidAt: dto.paidAt ? new Date(dto.paidAt) : now,
    });
    return { success: true };
  }
}
