import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import {
  TRANSFER_TARGET_NOT_ACCOUNT,
  TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
} from '../../shared/domain/transfer';
import { ConfirmTransferUseCase } from '../application/confirm-transfer.use-case';
import { CreateTransferUseCase } from '../application/create-transfer.use-case';
import { DeleteTransactionUseCase } from '../application/delete-transaction.use-case';
import { ReverseTransferUseCase } from '../application/reverse-transfer.use-case';
import { UnconfirmTransferUseCase } from '../application/unconfirm-transfer.use-case';
import { UpdateTransferUseCase } from '../application/update-transfer.use-case';
import {
  CreateTransferDto,
  UpdateTransferDto,
} from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import {
  DeleteResponseDto,
  SuccessResponseDto,
} from '../../shared/presentation/success-response.dto';

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
    private readonly reverseTransfer: ReverseTransferUseCase,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  @Post('transfers')
  @ApiOperation({ summary: 'Crea una transferencia entre dos cuentas' })
  @ApiCreatedResponse({ type: TransferResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateTransferDto) {
    this.assertAccountTarget(dto);
    return this.createTransfer.execute(userId, dto);
  }

  @Patch('transfers/:id')
  @ApiOperation({
    summary:
      'Reemplaza ambos movimientos de una transferencia por el id de uno',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
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
    summary:
      'Devuelve todos los movimientos de una transferencia a PENDING para editarla',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  async unconfirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.unconfirmTransfer.execute(userId, id);
    return { success: true };
  }

  @Post('transfers/:id/confirm')
  @ApiOperation({
    summary: 'Confirma todos los movimientos pendientes de una transferencia',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  async confirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.confirmTransfer.execute(userId, id);
    return { success: true };
  }

  @Post('transfers/:id/reverse')
  @ApiOperation({
    summary: 'Reversa todos los movimientos de una transferencia completada',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  async reverse(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.reverseTransfer.execute(userId, id);
    return { success: true };
  }

  @Delete('transfers/:id')
  @ApiOperation({
    summary:
      'Borra la transferencia completa por el id de uno de sus movimientos',
  })
  @ApiOkResponse({ type: DeleteResponseDto })
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
