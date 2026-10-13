import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { ConfirmTransferUseCase } from '../application/confirm-transfer.use-case';
import { CreateCardPaymentUseCase } from '../application/create-card-payment.use-case';
import { DeleteTransactionUseCase } from '../application/delete-transaction.use-case';
import { UnconfirmTransferUseCase } from '../application/unconfirm-transfer.use-case';
import { UpdateCardPaymentUseCase } from '../application/update-card-payment.use-case';
import {
  CreateCardPaymentDto,
  UpdateCardPaymentDto,
} from './dto/create-card-payment.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CardPaymentsController {
  constructor(
    private readonly createCardPayment: CreateCardPaymentUseCase,
    private readonly updateCardPayment: UpdateCardPaymentUseCase,
    private readonly unconfirmCardPayment: UnconfirmTransferUseCase,
    private readonly confirmCardPayment: ConfirmTransferUseCase,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  @Post('card-payments')
  @ApiOperation({ summary: 'Pay a credit card from an account' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCardPaymentDto,
  ) {
    return this.createCardPayment.execute(userId, dto);
  }

  @Patch('card-payments/:id')
  @ApiOperation({ summary: 'Edit a pending card payment' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardPaymentDto,
  ) {
    return this.updateCardPayment.execute(userId, id, dto);
  }

  @Post('card-payments/:id/unconfirm')
  @ApiOperation({ summary: 'Move every leg of a card payment back to PENDING' })
  async unconfirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.unconfirmCardPayment.execute(userId, id);
    return { success: true };
  }

  @Post('card-payments/:id/confirm')
  @ApiOperation({ summary: 'Confirm every pending leg of a card payment' })
  async confirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.confirmCardPayment.execute(userId, id);
    return { success: true };
  }

  @Delete('card-payments/:id')
  @ApiOperation({ summary: 'Delete the whole card payment' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.deleteTransaction.execute(userId, id);
  }
}
