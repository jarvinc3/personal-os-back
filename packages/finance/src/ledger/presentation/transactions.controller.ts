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
  @ApiOperation({ summary: 'List finance transactions' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.queries.listTransactions(userId, query);
  }

  @Post('balance-adjustments')
  @ApiOperation({
    summary: 'Set an account or card balance by posting an adjustment',
  })
  adjust(@CurrentUser('sub') userId: string, @Body() dto: AdjustBalanceDto) {
    return this.adjustBalance.execute(userId, dto);
  }

  @Post('transactions')
  @ApiOperation({ summary: 'Create a DEBIT or CREDIT transaction' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.createTx.execute(userId, dto, 'MANUAL');
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get transaction by id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.queries.getTransaction(userId, id);
  }

  @Patch('transactions/:id')
  @ApiOperation({ summary: 'Update transaction' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTransactionDto>,
  ) {
    return this.updateTx.execute(userId, id, dto);
  }

  @Delete('transactions/:id')
  @ApiOperation({ summary: 'Delete manual transaction' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.deleteTx.execute(userId, id);
  }

  @Post('transactions/:id/restore')
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.restoreTx.execute(userId, id, new Date());
  }

  @Post('transactions/:id/confirm')
  @ApiOperation({ summary: 'Confirm PENDING transaction' })
  confirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.confirmTx.execute(userId, id);
  }

  @Post('transactions/:id/unconfirm')
  @ApiOperation({
    summary: 'Move a CONFIRMED transaction back to PENDING to edit it',
  })
  unconfirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.unconfirmTx.execute(userId, id);
  }

  @Post('transactions/:id/reverse')
  @ApiOperation({
    summary: 'Reverse a CONFIRMED transaction (keeps the row as REVERSED)',
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
    summary: 'Delete a possible duplicate, keeping the other one',
  })
  async merge(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: MergeTransactionDto,
  ) {
    await this.mergeTx.execute(userId, id, dto.intoId);
    return { success: true };
  }

  @Post('transactions/:id/not-duplicate')
  @ApiOperation({ summary: 'Clear the possible-duplicate flag' })
  async notDuplicate(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    await this.notDuplicateTx.execute(userId, id);
    return { success: true };
  }
}
