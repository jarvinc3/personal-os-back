import {
  Body,
  Controller,
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
import { RecurringService } from '../application/recurring.service';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import {
  ListRecurringQueryDto,
  UpcomingRecurringQueryDto,
} from './dto/list-recurring-query.dto';
import { UpdateRecurringDto } from './dto/update-recurring.dto';
import {
  RecurringPageResponseDto,
  RecurringPatternResponseDto,
} from './dto/recurring-response.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get('recurring')
  @ApiOperation({
    summary: 'Lista los patrones recurrentes (sugeridos y confirmados)',
  })
  @ApiOkResponse({ type: RecurringPageResponseDto })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListRecurringQueryDto,
  ) {
    return this.recurring.list(userId, query);
  }

  @Get('recurring/upcoming')
  @ApiOperation({
    summary: 'Cargos confirmados previstos en los próximos N días',
  })
  @ApiOkResponse({ type: [RecurringPatternResponseDto] })
  upcoming(
    @CurrentUser('sub') userId: string,
    @Query() query: UpcomingRecurringQueryDto,
  ) {
    return this.recurring.upcoming(userId, query);
  }

  @Post('recurring')
  @ApiOperation({ summary: 'Crea un cargo recurrente a mano' })
  @ApiCreatedResponse({ type: RecurringPatternResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateRecurringDto) {
    return this.recurring.create(userId, dto);
  }

  @Patch('recurring/:id')
  @ApiOperation({ summary: 'Confirma, descarta o edita un patrón recurrente' })
  @ApiOkResponse({ type: RecurringPatternResponseDto })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringDto,
  ) {
    return this.recurring.update({ userId, id, dto });
  }
}
