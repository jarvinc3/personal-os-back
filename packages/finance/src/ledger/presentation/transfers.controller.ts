import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import {
  TRANSFER_TARGET_NOT_ACCOUNT,
  TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
} from '../../shared/domain/transfer';
import { ConfirmTransferUseCase } from '../application/confirm-transfer.use-case';
import { CreateTransferUseCase } from '../application/create-transfer.use-case';
import { DeleteTransactionUseCase } from '../application/delete-transaction.use-case';
import { UnconfirmTransferUseCase } from '../application/unconfirm-transfer.use-case';
import { UpdateTransferUseCase } from '../application/update-transfer.use-case';
import {
  CreateTransferDto,
  UpdateTransferDto,
} from './dto/create-transfer.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class TransfersController {
  constructor(
    private readonly createTransfer: CreateTransferUseCase,
    private readonly updateTransfer: UpdateTransferUseCase,
    private readonly unconfirmTransfer: UnconfirmTransferUseCase,
    private readonly confirmTransfer: ConfirmTransferUseCase,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  @Post('transfers')
  @ApiOperation({ summary: 'Create a transfer between two accounts' })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateTransferDto) {
    this.assertAccountTarget(dto);
    return this.createTransfer.execute(userId, dto);
  }

  @Patch('transfers/:id')
  @ApiOperation({
    summary: 'Replace both legs of a transfer by one of its leg ids',
  })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTransferDto,
  ) {
    this.assertAccountTarget(dto);
    return this.updateTransfer.execute(userId, id, dto);
  }

  @Post('transfers/:id/unconfirm')
  @ApiOperation({
    summary: 'Move every leg of a transfer back to PENDING to edit it',
  })
  async unconfirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.unconfirmTransfer.execute(userId, id);
    return { success: true };
  }

  @Post('transfers/:id/confirm')
  @ApiOperation({ summary: 'Confirm every pending leg of a transfer' })
  async confirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.confirmTransfer.execute(userId, id);
    return { success: true };
  }

  @Delete('transfers/:id')
  @ApiOperation({ summary: 'Delete the whole transfer by one of its leg ids' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.deleteTransaction.execute(userId, id);
  }

  private assertAccountTarget(dto: CreateTransferDto | UpdateTransferDto) {
    if (dto.toCardId || dto.fromCardId) {
      throw new BadRequestException({
        code: TRANSFER_TARGET_NOT_ACCOUNT,
        message: TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
      });
    }
  }
}
