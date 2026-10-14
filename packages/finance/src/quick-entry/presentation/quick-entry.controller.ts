import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { QuickEntryService } from '../application/quick-entry.service';
import { ParseQuickEntryDto } from './dto/parse-quick-entry.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/quick-entry')
export class QuickEntryController {
  constructor(private readonly quickEntry: QuickEntryService) {}

  @Post('parse')
  @ApiOperation({
    summary: 'Parse a quick sentence into a transaction draft (never saves)',
  })
  parse(@CurrentUser('sub') userId: string, @Body() dto: ParseQuickEntryDto) {
    return this.quickEntry.parse(userId, dto.text);
  }
}
