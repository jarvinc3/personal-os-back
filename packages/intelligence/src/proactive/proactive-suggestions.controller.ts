import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiProactiveService } from './ai-proactive.service';
import { ProactiveSuggestionsResponseDto } from './dto/proactive-suggestions-response.dto';

/** Sugerencias que dejaron los eventos relevantes, con el conteo de omitidos. */
@ApiTags('intelligence')
@ApiBearerAuth('access-token')
@Controller('intelligence')
export class ProactiveSuggestionsController {
  constructor(private readonly proactive: AiProactiveService) {}

  @Get('proactive-suggestions')
  @ApiOkResponse({ type: ProactiveSuggestionsResponseDto })
  list(@CurrentUser() user: { sub: string }) {
    return this.proactive.listForUser(user.sub);
  }
}
