import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../core/decorators';
import { PaginationQueryDto } from '../../../../core/pagination/pagination.dto';
import { PlanningService } from '../application/planning.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
export class BudgetsController {
  constructor(private readonly planning: PlanningService) {}

  @Get('budgets')
  @ApiOperation({
    summary: 'List budgets (paginated, default page=1 limit=20, max 100)',
  })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.planning.listBudgetsPage(userId, query);
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
}
