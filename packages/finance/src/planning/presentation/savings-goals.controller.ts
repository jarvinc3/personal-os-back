import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { PlanningService } from '../application/planning.service';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class SavingsGoalsController {
  constructor(private readonly planning: PlanningService) {}

  @Get('savings-goals')
  list(@CurrentUser('sub') userId: string) {
    return this.planning.listSavingsGoals(userId);
  }

  @Post('savings-goals')
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSavingsGoalDto,
  ) {
    return this.planning.createSavingsGoal(userId, dto);
  }

  @Patch('savings-goals/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSavingsGoalDto,
  ) {
    return this.planning.updateSavingsGoal(userId, id, dto);
  }

  @Delete('savings-goals/:id')
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteSavingsGoal(userId, id);
  }
}
