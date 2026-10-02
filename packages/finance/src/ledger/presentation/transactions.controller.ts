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
import {
  CurrentUser,
  RequiresEnabledModule,
} from '../../../../core/decorators';
import { ConfirmTransactionUseCase } from '../application/confirm-transaction.use-case';
import { CreateTransactionUseCase } from '../application/create-transaction.use-case';
import { DeleteTransactionUseCase } from '../application/delete-transaction.use-case';
import { LedgerQueryService } from '../application/ledger-query.service';
import { ReverseTransactionUseCase } from '../application/reverse-transaction.use-case';
import { UpdateTransactionUseCase } from '../application/update-transaction.use-case';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class TransactionsController {
  constructor(
    private readonly queries: LedgerQueryService,
    private readonly createTx: CreateTransactionUseCase,
    private readonly updateTx: UpdateTransactionUseCase,
    private readonly confirmTx: ConfirmTransactionUseCase,
    private readonly deleteTx: DeleteTransactionUseCase,
    private readonly reverseTx: ReverseTransactionUseCase,
  ) {}

  @Get('transactions')
  @ApiOperation({ summary: 'List finance transactions' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.queries.listTransactions(userId, query);
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

  @Post('transactions/:id/confirm')
  @ApiOperation({ summary: 'Confirm PENDING transaction' })
  confirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.confirmTx.execute(userId, id);
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
}
