import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Public } from '../../core/decorators';
import { ConnectEmailSourceDto } from './dto/connect-email-source.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { CreateLoanDto } from './dto/create-loan.dto';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { SpendingOverTimeQueryDto } from './dto/spending-over-time-query.dto';
import {
  GoogleOAuthUrlQueryDto,
  OAuthCallbackQueryDto,
} from './dto/oauth-callback-query.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { UpdateCardBalanceDto } from './dto/update-card-balance.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateEmailSourceDto } from './dto/update-email-source.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';
import { FinanceService } from './finance.service';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) { }

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

  @Patch('transactions/:id')
  @ApiOperation({ summary: 'Update transaction' })
  updateTransaction(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTransactionDto>,
  ) {
    return this.financeService.updateTransaction(userId, id, dto);
  }

  @Delete('transactions/:id')
  @ApiOperation({ summary: 'Delete manual transaction' })
  deleteTransaction(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.deleteTransaction(userId, id);
  }

  @Post('transactions/:id/confirm')
  @ApiOperation({ summary: 'Confirm pending transaction' })
  confirmTransaction(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.confirmTransaction(userId, id);
  }

  @Get('institutions')
  @ApiOperation({ summary: 'List institutions' })
  listInstitutions(@CurrentUser('sub') userId: string) {
    return this.financeService.listInstitutions(userId);
  }

  @Post('institutions')
  @ApiOperation({ summary: 'Create institution' })
  createInstitution(@CurrentUser('sub') userId: string, @Body() dto: CreateInstitutionDto) {
    return this.financeService.createInstitution(userId, dto);
  }

  @Patch('institutions/:id')
  @ApiOperation({ summary: 'Update institution' })
  updateInstitution(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInstitutionDto,
  ) {
    return this.financeService.updateInstitution(userId, id, dto);
  }

  @Delete('institutions/:id')
  @ApiOperation({ summary: 'Deactivate institution' })
  deactivateInstitution(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.deactivateInstitution(userId, id);
  }

  @Get('cards')
  @ApiOperation({ summary: 'List cards' })
  listCards(@CurrentUser('sub') userId: string) {
    return this.financeService.listCards(userId);
  }

  @Post('cards')
  @ApiOperation({ summary: 'Create card' })
  createCard(@CurrentUser('sub') userId: string, @Body() dto: CreateCardDto) {
    return this.financeService.createCard(userId, dto);
  }

  @Get('cards/:id')
  @ApiOperation({ summary: 'Get card' })
  getCard(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.getCard(userId, id);
  }

  @Patch('cards/:id')
  @ApiOperation({ summary: 'Update card' })
  updateCard(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardDto,
  ) {
    return this.financeService.updateCard(userId, id, dto);
  }

  @Post('cards/:id/balances')
  @ApiOperation({ summary: 'Upsert card balance by currency' })
  updateCardBalance(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardBalanceDto,
  ) {
    return this.financeService.updateCardBalance(userId, id, dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List categories' })
  listCategories(@CurrentUser('sub') userId: string) {
    return this.financeService.listCategories(userId);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create custom category' })
  createCategory(@CurrentUser('sub') userId: string, @Body() dto: CreateCategoryDto) {
    return this.financeService.createCategory(userId, dto);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update custom category' })
  updateCategory(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.financeService.updateCategory(userId, id, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Delete custom category' })
  deleteCategory(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.deleteCategory(userId, id);
  }

  @Get('budgets')
  @ApiOperation({ summary: 'List budgets' })
  listBudgets(@CurrentUser('sub') userId: string) {
    return this.financeService.listBudgets(userId);
  }

  @Post('budgets')
  @ApiOperation({ summary: 'Create budget' })
  createBudget(@CurrentUser('sub') userId: string, @Body() dto: CreateBudgetDto) {
    return this.financeService.createBudget(userId, dto);
  }

  @Patch('budgets/:id')
  @ApiOperation({ summary: 'Update budget' })
  updateBudget(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.financeService.updateBudget(userId, id, dto);
  }

  @Delete('budgets/:id')
  @ApiOperation({ summary: 'Delete budget' })
  deleteBudget(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.deleteBudget(userId, id);
  }

  @Get('savings-goals')
  @ApiOperation({ summary: 'List savings goals' })
  listSavingsGoals(@CurrentUser('sub') userId: string) {
    return this.financeService.listSavingsGoals(userId);
  }

  @Post('savings-goals')
  @ApiOperation({ summary: 'Create savings goal' })
  createSavingsGoal(@CurrentUser('sub') userId: string, @Body() dto: CreateSavingsGoalDto) {
    return this.financeService.createSavingsGoal(userId, dto);
  }

  @Patch('savings-goals/:id')
  @ApiOperation({ summary: 'Update savings goal' })
  updateSavingsGoal(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSavingsGoalDto,
  ) {
    return this.financeService.updateSavingsGoal(userId, id, dto);
  }

  @Delete('savings-goals/:id')
  @ApiOperation({ summary: 'Delete savings goal' })
  deleteSavingsGoal(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.deleteSavingsGoal(userId, id);
  }

  @Get('loans')
  @ApiOperation({ summary: 'List loans' })
  listLoans(@CurrentUser('sub') userId: string) {
    return this.financeService.listLoans(userId);
  }

  @Post('loans')
  @ApiOperation({ summary: 'Create loan' })
  createLoan(@CurrentUser('sub') userId: string, @Body() dto: CreateLoanDto) {
    return this.financeService.createLoan(userId, dto);
  }

  @Patch('loans/:id')
  @ApiOperation({ summary: 'Update loan' })
  updateLoan(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.financeService.updateLoan(userId, id, dto);
  }

  @Get('receivables')
  @ApiOperation({ summary: 'List receivables' })
  listReceivables(@CurrentUser('sub') userId: string) {
    return this.financeService.listReceivables(userId);
  }

  @Post('receivables')
  @ApiOperation({ summary: 'Create receivable' })
  createReceivable(@CurrentUser('sub') userId: string, @Body() dto: CreateReceivableDto) {
    return this.financeService.createReceivable(userId, dto);
  }

  @Patch('receivables/:id')
  @ApiOperation({ summary: 'Update receivable' })
  updateReceivable(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
  ) {
    return this.financeService.updateReceivable(userId, id, dto);
  }

  @Get('email-sync/sources')
  @ApiOperation({ summary: 'List email sync sources' })
  listEmailSources(@CurrentUser('sub') userId: string) {
    return this.financeService.listEmailSources(userId);
  }

  @Post('email-sync/sources')
  @ApiOperation({ summary: 'Create Gmail source' })
  createEmailSource(@CurrentUser('sub') userId: string, @Body() dto: ConnectEmailSourceDto) {
    return this.financeService.createEmailSource(userId, dto);
  }

  @Patch('email-sync/sources/:id')
  @ApiOperation({ summary: 'Update email sync source' })
  updateEmailSource(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmailSourceDto,
  ) {
    return this.financeService.updateEmailSource(userId, id, dto);
  }

  @Delete('email-sync/sources/:id')
  @ApiOperation({ summary: 'Deactivate email source' })
  deactivateEmailSource(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.financeService.deactivateEmailSource(userId, id);
  }

  @Post('email-sync/sources/:id/sync')
  @ApiOperation({ summary: 'Trigger manual sync' })
  triggerEmailSync(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query('forceFullSync') forceFullSync?: string,
  ) {
    return this.financeService.triggerEmailSync(userId, id, forceFullSync === 'true');
  }

  @Get('email-sync/oauth/google/url')
  @ApiOperation({ summary: 'Get Google OAuth URL for Gmail sync' })
  getGoogleOAuthUrl(
    @CurrentUser('sub') userId: string,
    @Query() query: GoogleOAuthUrlQueryDto,
  ) {
    return this.financeService.getGoogleOAuthUrl(userId, query);
  }

  @Public()
  @Get('email-sync/oauth/google/callback')
  @ApiOperation({ summary: 'Google OAuth callback for Gmail sync' })
  async handleGoogleCallback(
    @Query() query: OAuthCallbackQueryDto,
    @Res() res: Response,
  ) {
    const appRedirectBase = 'personal-os://finance/oauth/callback';
    try {
      await this.financeService.handleGoogleOAuthCallback(query.code, query.state);
      res.redirect(`${appRedirectBase}?success=true`);
    } catch {
      res.redirect(`${appRedirectBase}?success=false`);
    }
  }

  @Get('analytics/summary')
  @ApiOperation({ summary: 'Analytics summary' })
  analyticsSummary(
    @CurrentUser('sub') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.financeService.getAnalyticsSummary(userId, dateFrom, dateTo);
  }

  @Get('analytics/spending-by-category')
  @ApiOperation({ summary: 'Spending breakdown by category' })
  spendingByCategory(
    @CurrentUser('sub') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.financeService.getSpendingByCategory(userId, dateFrom, dateTo);
  }

  @Get('analytics/budget-status')
  @ApiOperation({ summary: 'Budget status overview' })
  budgetStatus(@CurrentUser('sub') userId: string) {
    return this.financeService.getBudgetStatus(userId);
  }

  @Get('analytics/spending-over-time')
  @ApiOperation({ summary: 'Income and expenses over time' })
  spendingOverTime(
    @CurrentUser('sub') userId: string,
    @Query() query: SpendingOverTimeQueryDto,
  ) {
    return this.financeService.getSpendingOverTime(
      userId,
      query.dateFrom,
      query.dateTo,
      query.granularity ?? 'day',
    );
  }

  @Post('categories/migrate-legacy-icons')
  @ApiOperation({ summary: 'Migrate Lucide icon keys to emoji on user categories' })
  migrateLegacyCategoryIcons(@CurrentUser('sub') userId: string) {
    return this.financeService.migrateLegacyCategoryIcons(userId);
  }
}
