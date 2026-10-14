import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { RecurringService } from '../application/recurring.service';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import {
  ListRecurringQueryDto,
  UpcomingRecurringQueryDto,
} from './dto/list-recurring-query.dto';
import { UpdateRecurringDto } from './dto/update-recurring.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get('recurring')
  @ApiOperation({ summary: 'List recurring patterns (suggested and confirmed)' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListRecurringQueryDto,
  ) {
    return this.recurring.list(userId, query);
  }

  @Get('recurring/upcoming')
  @ApiOperation({ summary: 'Confirmed charges expected in the next N days' })
  upcoming(
    @CurrentUser('sub') userId: string,
    @Query() query: UpcomingRecurringQueryDto,
  ) {
    return this.recurring.upcoming(userId, query);
  }

  @Post('recurring')
  @ApiOperation({ summary: 'Create a recurring charge by hand' })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateRecurringDto) {
    return this.recurring.create(userId, dto);
  }

  @Patch('recurring/:id')
  @ApiOperation({ summary: 'Confirm, dismiss or edit a recurring pattern' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringDto,
  ) {
    return this.recurring.update(userId, id, dto);
  }
}
