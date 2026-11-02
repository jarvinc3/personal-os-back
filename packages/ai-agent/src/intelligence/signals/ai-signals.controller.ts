import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiSignalListResponseDto, AiSignalResponseDto } from './ai-signal.dto';
import { AiSignalsService } from './ai-signals.service';

@ApiTags('intelligence')
@ApiBearerAuth('access-token')
@Controller('intelligence/signals')
export class AiSignalsController {
  constructor(private readonly signals: AiSignalsService) {}

  @Get()
  @ApiOkResponse({ type: AiSignalListResponseDto })
  list(@CurrentUser() user: { sub: string }) {
    return this.signals.listForUser(user.sub);
  }

  @Get(':signalId')
  @ApiOkResponse({ type: AiSignalResponseDto })
  get(
    @CurrentUser() user: { sub: string },
    @Param('signalId') signalId: string,
  ) {
    return this.signals.getForUser(user.sub, signalId);
  }
}
