import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { TRANSACTION_LINK_KIND } from '../../shared/domain/transaction-links';
import {
  LinkTransactionUseCase,
  type LinkTransactionCommand,
} from '../application/link-transaction.use-case';
import { UnlinkTransactionUseCase } from '../application/unlink-transaction.use-case';
import { LinkTransactionDto } from './dto/link-transaction.dto';

function toCommand(dto: LinkTransactionDto): LinkTransactionCommand {
  if (dto.kind === TRANSACTION_LINK_KIND.LOAN_INSTALLMENT) {
    if (!dto.loanId || !dto.installmentId) {
      throw new BadRequestException('loanId e installmentId son obligatorios');
    }
    return {
      kind: TRANSACTION_LINK_KIND.LOAN_INSTALLMENT,
      loanId: dto.loanId,
      installmentId: dto.installmentId,
    };
  }
  if (dto.kind === TRANSACTION_LINK_KIND.RECEIVABLE_PAYMENT) {
    if (!dto.receivableId) {
      throw new BadRequestException('receivableId es obligatorio');
    }
    return {
      kind: TRANSACTION_LINK_KIND.RECEIVABLE_PAYMENT,
      receivableId: dto.receivableId,
    };
  }
  if (!dto.goalId) {
    throw new BadRequestException('goalId es obligatorio');
  }
  return {
    kind: TRANSACTION_LINK_KIND.SAVINGS_CONTRIBUTION,
    goalId: dto.goalId,
  };
}

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class TransactionLinksController {
  constructor(
    private readonly linkTransaction: LinkTransactionUseCase,
    private readonly unlinkTransaction: UnlinkTransactionUseCase,
  ) {}

  @Post('transactions/:id/link')
  @ApiOperation({
    summary:
      'Link an existing movement to a loan instalment, a collection or a goal',
  })
  create(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: LinkTransactionDto,
  ) {
    return this.linkTransaction.execute(userId, id, toCommand(dto), new Date());
  }

  @Delete('transactions/:id/link')
  @ApiOperation({
    summary:
      'Quita el vínculo de planificación de un movimiento y deshace su efecto',
  })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.unlinkTransaction.execute(userId, id, new Date());
  }
}
