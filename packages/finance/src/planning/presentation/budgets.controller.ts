import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CursorQueryDto } from '@personal-os/core';
import { PlanningService } from '../application/planning.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import {
  BudgetPageResponseDto,
  BudgetResponseDto,
} from './dto/budget-response.dto';
import { TransactionPageResponseDto } from '../../shared/presentation/dto/transaction-response.dto';
import { SuccessResponseDto } from '../../shared/presentation/success-response.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class BudgetsController {
  constructor(private readonly planning: PlanningService) {}

  @Get('budgets')
  @ApiOperation({
    summary:
      'Lista los presupuestos (cursor, límite por defecto 20, máximo 100)',
  })
  @ApiOkResponse({ type: BudgetPageResponseDto })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.planning.listBudgetsPage(userId, query);
  }

  @Get('budgets/:id')
  @ApiOperation({ summary: 'Obtiene un presupuesto por id' })
  @ApiOkResponse({ type: BudgetResponseDto })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getBudget(userId, id);
  }

  @Get('budgets/:id/transactions')
  @ApiOperation({
    summary:
      'Movimientos que cuentan para el presupuesto, con sus subcategorías',
  })
  @ApiOkResponse({ type: TransactionPageResponseDto })
  transactions(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.planning.getBudgetTransactions(userId, id, query);
  }

  @Post('budgets')
  @ApiCreatedResponse({ type: BudgetResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateBudgetDto) {
    return this.planning.createBudget(userId, dto);
  }

  @Patch('budgets/:id')
  @ApiOkResponse({ type: BudgetResponseDto })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.planning.updateBudget(userId, id, dto);
  }

  @Delete('budgets/:id')
  @ApiOkResponse({ type: SuccessResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteBudget(userId, id);
  }

  @Post('budgets/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreBudget(userId, id, new Date());
  }
}
