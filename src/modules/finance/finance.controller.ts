import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/decorators';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { FinanceService } from './finance.service';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'List finance accounts for current user' })
  listAccounts(@CurrentUser('sub') userId: string) {
    return this.financeService.listAccounts(userId);
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Create a finance account' })
  createAccount(@CurrentUser('sub') userId: string, @Body() dto: CreateAccountDto) {
    return this.financeService.createAccount(userId, dto);
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Get finance account by id' })
  getAccount(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.getAccount(userId, id);
  }

  @Patch('accounts/:id')
  @ApiOperation({ summary: 'Update finance account' })
  updateAccount(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.financeService.updateAccount(userId, id, dto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List finance transactions' })
  listTransactions(
    @CurrentUser('sub') userId: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.financeService.listTransactions(userId, query);
  }

  @Post('transactions')
  @ApiOperation({ summary: 'Create a finance transaction' })
  createTransaction(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.financeService.createTransaction(userId, dto);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get finance transaction by id' })
  getTransaction(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.getTransaction(userId, id);
  }
}
