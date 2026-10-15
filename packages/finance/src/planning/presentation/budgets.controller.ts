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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CursorQueryDto } from '@personal-os/core';
import { PlanningService } from '../application/planning.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

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
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.planning.listBudgetsPage(userId, query);
  }

  @Get('budgets/:id')
  @ApiOperation({ summary: 'Obtiene un presupuesto por id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getBudget(userId, id);
  }

  @Get('budgets/:id/transactions')
  @ApiOperation({
    summary:
      'Movimientos que cuentan para el presupuesto, con sus subcategorías',
  })
  transactions(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.planning.getBudgetTransactions(userId, id, query);
  }

  @Post('budgets')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateBudgetDto) {
    return this.planning.createBudget(userId, dto);
  }

  @Patch('budgets/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.planning.updateBudget(userId, id, dto);
  }

  @Delete('budgets/:id')
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteBudget(userId, id);
  }

  @Post('budgets/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreBudget(userId, id, new Date());
  }
}
