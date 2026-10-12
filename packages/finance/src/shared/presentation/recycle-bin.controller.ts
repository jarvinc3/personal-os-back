import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { RecycleBinService } from '../application/recycle-bin.service';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class RecycleBinController {
  constructor(private readonly recycleBin: RecycleBinService) {}

  @Get('recycle-bin')
  @ApiOperation({ summary: 'List archived records and pending deletes' })
  list(@CurrentUser('sub') userId: string) {
    return this.recycleBin.get(userId);
  }
}
