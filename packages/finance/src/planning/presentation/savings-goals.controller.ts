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
import { RecordSavingsGoalContributionUseCase } from '../application/record-savings-goal-contribution.use-case';
import { RemoveSavingsGoalContributionUseCase } from '../application/remove-savings-goal-contribution.use-case';
import { CreateSavingsGoalContributionDto } from './dto/create-savings-goal-contribution.dto';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class SavingsGoalsController {
  constructor(
    private readonly planning: PlanningService,
    private readonly recordContribution: RecordSavingsGoalContributionUseCase,
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

  @Get('savings-goals/:id/contributions')
  @ApiOperation({ summary: 'Contributions of a savings goal, newest first' })
  listContributions(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.planning.listSavingsGoalContributions(userId, id);
  }

  @Post('savings-goals/:id/contributions')
  @ApiOperation({
    summary: 'Record a contribution; the goal balance is the sum of them',
  })
  addContribution(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateSavingsGoalContributionDto,
  ) {
    return this.recordContribution.execute(userId, id, dto, new Date());
  }

  @Delete('savings-goals/:id/contributions/:contributionId')
  @ApiOperation({ summary: 'Remove a contribution and recompute the balance' })
  removeContribution(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('contributionId') contributionId: string,
  ) {
    return this.removeGoalContribution.execute(
      userId,
      id,
      contributionId,
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
