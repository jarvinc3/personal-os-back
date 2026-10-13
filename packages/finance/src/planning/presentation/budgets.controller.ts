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
    summary: 'List budgets (cursor paginated, default limit=20, max 100)',
  })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.planning.listBudgetsPage(userId, query);
  }

  @Get('budgets/:id')
  @ApiOperation({ summary: 'Get a budget by id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getBudget(userId, id);
  }

  @Get('budgets/:id/transactions')
  @ApiOperation({
    summary: 'Movements that count toward the budget, with their subcategories',
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
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreBudget(userId, id, new Date());
  }
}
