import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { PlanningService } from '../application/planning.service';
import { AllocateToGoalUseCase } from '../application/allocate-to-goal.use-case';
import { RemoveSavingsGoalContributionUseCase } from '../application/remove-savings-goal-contribution.use-case';
import { CreateSavingsGoalAllocationDto } from './dto/create-savings-goal-allocation.dto';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class SavingsGoalsController {
  constructor(
    private readonly planning: PlanningService,
    private readonly allocateToGoal: AllocateToGoalUseCase,
    private readonly removeGoalContribution: RemoveSavingsGoalContributionUseCase,
  ) {}

  @Get('savings-goals')
  list(@CurrentUser('sub') userId: string) {
    return this.planning.listSavingsGoals(userId);
  }

  @Post('savings-goals')
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSavingsGoalDto,
  ) {
    return this.planning.createSavingsGoal(userId, dto, new Date());
  }

  @Get('savings-goals/:id')
  @ApiOperation({ summary: 'Get savings goal by id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getSavingsGoal(userId, id);
  }

  @Get('savings-goals/:id/allocations')
  @ApiOperation({ summary: 'Allocations of a savings goal, newest first' })
  listAllocations(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.listSavingsGoalContributions(userId, id);
  }

  @Post('savings-goals/:id/allocations')
  @ApiOperation({
    summary: 'Set money aside for a goal; it never moves money',
  })
  addAllocation(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateSavingsGoalAllocationDto,
  ) {
    return this.allocateToGoal.execute(userId, id, dto, new Date());
  }

  @Delete('savings-goals/:id/allocations/:allocationId')
  @ApiOperation({ summary: 'Remove an allocation and recompute the balance' })
  removeAllocation(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
  ) {
    return this.removeGoalContribution.execute(
      userId,
      id,
      allocationId,
      new Date(),
    );
  }

  @Get('savings-goals/:id/contributions')
  @ApiOperation({
    summary: 'Deprecated alias of allocations',
    deprecated: true,
  })
  listContributions(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.planning.listSavingsGoalContributions(userId, id);
  }

  @Post('savings-goals/:id/contributions')
  @ApiOperation({
    summary: 'Deprecated alias of allocations',
    deprecated: true,
  })
  addContribution(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateSavingsGoalAllocationDto,
  ) {
    return this.allocateToGoal.execute(userId, id, dto, new Date());
  }

  @Delete('savings-goals/:id/contributions/:allocationId')
  @ApiOperation({
    summary: 'Deprecated alias of allocation removal',
    deprecated: true,
  })
  removeContribution(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
  ) {
    return this.removeGoalContribution.execute(
      userId,
      id,
      allocationId,
      new Date(),
    );
  }

  @Patch('savings-goals/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSavingsGoalDto,
  ) {
    return this.planning.updateSavingsGoal(userId, id, dto, new Date());
  }

  @Delete('savings-goals/:id')
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteSavingsGoal(userId, id);
  }

  @Post('savings-goals/:id/restore')
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreSavingsGoal(userId, id, new Date());
  }
}
