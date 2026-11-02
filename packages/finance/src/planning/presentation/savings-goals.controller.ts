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
import { AllocateToGoalUseCase } from '../application/allocate-to-goal.use-case';
import { RemoveSavingsGoalContributionUseCase } from '../application/remove-savings-goal-contribution.use-case';
import { CreateSavingsGoalAllocationDto } from './dto/create-savings-goal-allocation.dto';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';
import {
  SavingsGoalContributionPageResponseDto,
  SavingsGoalContributionResponseDto,
  SavingsGoalPageResponseDto,
  SavingsGoalResponseDto,
} from './dto/savings-goal-response.dto';
import { SuccessResponseDto } from '../../shared/presentation/success-response.dto';

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
  @ApiOkResponse({ type: SavingsGoalPageResponseDto })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.planning.listSavingsGoalsPage(userId, query);
  }

  @Post('savings-goals')
  @ApiCreatedResponse({ type: SavingsGoalResponseDto })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSavingsGoalDto,
  ) {
    return this.planning.createSavingsGoal(userId, dto, new Date());
  }

  @Get('savings-goals/:id')
  @ApiOperation({ summary: 'Obtiene una meta de ahorro por id' })
  @ApiOkResponse({ type: SavingsGoalResponseDto })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getSavingsGoal(userId, id);
  }

  @Get('savings-goals/:id/allocations')
  @ApiOperation({
    summary: 'Asignaciones de una meta de ahorro, más recientes primero',
  })
  @ApiOkResponse({ type: SavingsGoalContributionPageResponseDto })
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
  @ApiCreatedResponse({ type: SavingsGoalContributionResponseDto })
  addAllocation(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateSavingsGoalAllocationDto,
  ) {
    return this.allocateToGoal.execute(userId, id, dto, new Date());
  }

  @Delete('savings-goals/:id/allocations/:allocationId')
  @ApiOperation({ summary: 'Elimina una asignación y recalcula el saldo' })
  @ApiOkResponse({ type: SuccessResponseDto })
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
  @ApiOkResponse({ type: SavingsGoalContributionPageResponseDto })
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
  @ApiCreatedResponse({ type: SavingsGoalContributionResponseDto })
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
  @ApiOkResponse({ type: SuccessResponseDto })
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
  @ApiOkResponse({ type: SavingsGoalResponseDto })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSavingsGoalDto,
  ) {
    return this.planning.updateSavingsGoal(userId, id, dto, new Date());
  }

  @Delete('savings-goals/:id')
  @ApiOkResponse({ type: SuccessResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteSavingsGoal(userId, id);
  }

  @Post('savings-goals/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreSavingsGoal(userId, id, new Date());
  }
}
