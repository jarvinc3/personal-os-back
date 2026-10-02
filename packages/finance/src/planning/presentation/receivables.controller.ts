import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequiresEnabledModule,
} from '../../../../core/decorators';
import { PlanningService } from '../application/planning.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class ReceivablesController {
  constructor(private readonly planning: PlanningService) {}

  @Get('receivables')
  list(@CurrentUser('sub') userId: string) {
    return this.planning.listReceivables(userId);
  }

  @Post('receivables')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateReceivableDto) {
    return this.planning.createReceivable(userId, dto);
  }

  @Patch('receivables/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
  ) {
    return this.planning.updateReceivable(userId, id, dto);
  }

  @Delete('receivables/:id')
  @ApiOperation({ summary: 'Hard-delete receivable' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteReceivable(userId, id);
  }
}
