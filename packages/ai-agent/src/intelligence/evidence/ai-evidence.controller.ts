import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiEvidenceService } from './ai-evidence.service';
import { CreateHumanVerificationDto } from './dto/create-human-verification.dto';

@ApiTags('intelligence-evidence')
@ApiBearerAuth('access-token')
@Controller('intelligence')
export class AiEvidenceController {
  constructor(private readonly evidence: AiEvidenceService) {}

  @Get('dataset')
  dataset(@CurrentUser() user: { sub: string }) {
    return this.evidence.datasetSummary(user.sub);
  }

  @Get('review-queue')
  reviewQueue(
    @CurrentUser() user: { sub: string },
    @Query('cursor') cursor?: string,
  ) {
    return this.evidence.reviewQueue(user.sub, cursor);
  }

  @Post('messages/:messageId/verifications')
  verifyMessage(
    @CurrentUser() user: { sub: string },
    @Param('messageId') messageId: string,
    @Body() dto: CreateHumanVerificationDto,
  ) {
    return this.evidence.verifyMessage(user.sub, messageId, dto);
  }

  @Get('runs')
  runs(@CurrentUser() user: { sub: string }) {
    return this.evidence.listRuns(user.sub);
  }
}
