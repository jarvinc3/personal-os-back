import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CursorQueryDto,
  RequiresEnabledModule,
} from '@personal-os/core';
import { RecycleBinService } from '../application/recycle-bin.service';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class RecycleBinController {
  constructor(private readonly recycleBin: RecycleBinService) {}

  @Get('recycle-bin')
  @ApiOperation({
    summary:
      'Lista los registros archivados y los borrados pendientes (borrados paginados)',
  })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.recycleBin.get(userId, query);
  }
}
