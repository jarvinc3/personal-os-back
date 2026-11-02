import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CursorQueryDto,
  RequiresEnabledModule,
} from '@personal-os/core';
import { RecycleBinService } from '../application/recycle-bin.service';
import { RecycleBinResponseDto } from './dto/recycle-bin-response.dto';

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
  @ApiOkResponse({ type: RecycleBinResponseDto })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.recycleBin.get(userId, query);
  }
}
