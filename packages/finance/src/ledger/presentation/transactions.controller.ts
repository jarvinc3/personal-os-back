import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { AdjustBalanceUseCase } from '../application/adjust-balance.use-case';
import { ConfirmTransactionUseCase } from '../application/confirm-transaction.use-case';
import { CreateTransactionUseCase } from '../application/create-transaction.use-case';
import { DeleteTransactionUseCase } from '../application/delete-transaction.use-case';
import { MarkNotDuplicateUseCase } from '../application/mark-not-duplicate.use-case';
import { MergeTransactionUseCase } from '../application/merge-transaction.use-case';
import { RestoreTransactionUseCase } from '../application/restore-transaction.use-case';
import { LedgerQueryService } from '../application/ledger-query.service';
import { ReverseTransactionUseCase } from '../application/reverse-transaction.use-case';
import { UnconfirmTransactionUseCase } from '../application/unconfirm-transaction.use-case';
import { UpdateTransactionUseCase } from '../application/update-transaction.use-case';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { MergeTransactionDto } from './dto/merge-transaction.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class TransactionsController {
  constructor(
    private readonly queries: LedgerQueryService,
    private readonly createTx: CreateTransactionUseCase,
    private readonly adjustBalance: AdjustBalanceUseCase,
    private readonly updateTx: UpdateTransactionUseCase,
    private readonly confirmTx: ConfirmTransactionUseCase,
    private readonly unconfirmTx: UnconfirmTransactionUseCase,
    private readonly deleteTx: DeleteTransactionUseCase,
    private readonly restoreTx: RestoreTransactionUseCase,
    private readonly reverseTx: ReverseTransactionUseCase,
    private readonly mergeTx: MergeTransactionUseCase,
    private readonly notDuplicateTx: MarkNotDuplicateUseCase,
  ) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Lista las transacciones de finanzas' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.queries.listTransactions(userId, query);
  }

  @Post('balance-adjustments')
  @ApiOperation({
    summary: 'Fija el saldo de una cuenta o tarjeta con un ajuste',
  })
  adjust(@CurrentUser('sub') userId: string, @Body() dto: AdjustBalanceDto) {
    return this.adjustBalance.execute(userId, dto);
  }

  @Post('transactions')
  @ApiOperation({ summary: 'Crea una transacción DEBIT o CREDIT' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.createTx.execute(userId, dto, 'MANUAL');
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Obtiene una transacción por id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.queries.getTransaction(userId, id);
  }

  @Patch('transactions/:id')
  @ApiOperation({ summary: 'Actualiza una transacción' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTransactionDto>,
  ) {
    return this.updateTx.execute(userId, id, dto);
  }

  @Delete('transactions/:id')
  @ApiOperation({ summary: 'Borra una transacción manual' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.deleteTx.execute(userId, id);
  }

  @Post('transactions/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.restoreTx.execute(userId, id, new Date());
  }

  @Post('transactions/:id/confirm')
  @ApiOperation({ summary: 'Confirma una transacción PENDING' })
  confirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.confirmTx.execute(userId, id);
  }

  @Post('transactions/:id/unconfirm')
  @ApiOperation({
    summary: 'Devuelve una transacción CONFIRMED a PENDING para editarla',
  })
  unconfirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.unconfirmTx.execute(userId, id);
  }

  @Post('transactions/:id/reverse')
  @ApiOperation({
    summary:
      'Revierte una transacción CONFIRMED (conserva la fila como REVERSED)',
  })
  async reverse(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    const existing = await this.queries.getTransaction(userId, id);
    if (existing.status === 'REVERSED') {
      return existing;
    }
    if (existing.transferGroupId) {
      throw new BadRequestException(
        'Reversing one leg of a transfer is not supported',
      );
    }
    if (existing.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Only CONFIRMED transactions can be reversed',
      );
    }
    return this.reverseTx.execute(userId, id);
  }

  @Post('transactions/:id/merge')
  @ApiOperation({
    summary: 'Borra un posible duplicado y conserva el otro',
  })
  merge(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: MergeTransactionDto,
  ) {
    return this.mergeTx.execute(userId, id, dto.intoId);
  }

  @Post('transactions/:id/not-duplicate')
  @ApiOperation({ summary: 'Quita la marca de posible duplicado' })
  notDuplicate(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.notDuplicateTx.execute(userId, id);
  }
}
