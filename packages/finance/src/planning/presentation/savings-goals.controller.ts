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
  @ApiOperation({ summary: 'Lista las metas de ahorro (cursor)' })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.planning.listSavingsGoalsPage(userId, query);
  }

  @Post('savings-goals')
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSavingsGoalDto,
  ) {
    return this.planning.createSavingsGoal(userId, dto, new Date());
  }

  @Get('savings-goals/:id')
  @ApiOperation({ summary: 'Obtiene una meta de ahorro por id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getSavingsGoal(userId, id);
  }

  @Get('savings-goals/:id/allocations')
  @ApiOperation({
    summary: 'Asignaciones de una meta de ahorro, más recientes primero',
  })
  listAllocations(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.planning.listSavingsGoalContributions(userId, id, query);
  }

  @Post('savings-goals/:id/allocations')
  @ApiOperation({
    summary: 'Reserva dinero para una meta; no mueve dinero',
  })
  addAllocation(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateSavingsGoalAllocationDto,
  ) {
    return this.allocateToGoal.execute(userId, id, dto, new Date());
  }

  @Delete('savings-goals/:id/allocations/:allocationId')
  @ApiOperation({ summary: 'Elimina una asignación y recalcula el saldo' })
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
    summary: 'Alias deprecado de las asignaciones',
    deprecated: true,
  })
  listContributions(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.planning.listSavingsGoalContributions(userId, id, query);
  }

  @Post('savings-goals/:id/contributions')
  @ApiOperation({
    summary: 'Alias deprecado de las asignaciones',
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
    summary: 'Alias deprecado del borrado de asignaciones',
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
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreSavingsGoal(userId, id, new Date());
  }
}
