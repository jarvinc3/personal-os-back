import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiConsentService } from './ai-consent.service';
import { UpdateConsentDto } from './dto/update-consent.dto';

@ApiTags('intelligence-preferences')
@ApiBearerAuth('access-token')
@Controller('ai/preferences/consent')
export class AiConsentController {
  constructor(private readonly consent: AiConsentService) {}

  @Get()
  get(@CurrentUser() user: { sub: string }) {
    return this.consent.get(user.sub);
  }

  @Patch()
  update(@CurrentUser() user: { sub: string }, @Body() dto: UpdateConsentDto) {
    return this.consent.update(user.sub, dto.contributeToGlobalKnowledge);
  }
}
