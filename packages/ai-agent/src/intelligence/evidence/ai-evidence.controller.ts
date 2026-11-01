import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiEvidenceService } from './ai-evidence.service';
import { CreateHumanVerificationDto } from './dto/create-human-verification.dto';
import { CreateReviewGroupVerificationDto } from './dto/create-review-group-verification.dto';
import { ReviewGroupsQueryDto } from './dto/review-groups-query.dto';
import { ReviewQueueQueryDto } from './dto/review-queue-query.dto';

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
    @Query() query: ReviewQueueQueryDto,
  ) {
    return this.evidence.reviewQueue(user.sub, query);
  }

  @Get('review-groups')
  reviewGroups(
    @CurrentUser() user: { sub: string },
    @Query() query: ReviewGroupsQueryDto,
  ) {
    return this.evidence.listReviewGroups(user.sub, query);
  }

  @Post('review-groups/verifications')
  verifyReviewGroup(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateReviewGroupVerificationDto,
  ) {
    return this.evidence.verifyReviewGroup(user.sub, dto);
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
