import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiEvidenceService } from './ai-evidence.service';
import { CreateHumanVerificationDto } from './dto/create-human-verification.dto';
import { CreateReviewGroupVerificationDto } from './dto/create-review-group-verification.dto';
import { CreateReviewSelectionVerificationDto } from './dto/create-review-selection-verification.dto';
import { ReviewGroupsQueryDto } from './dto/review-groups-query.dto';
import { ReviewQueueQueryDto } from './dto/review-queue-query.dto';
import { CompareAnalysisRunsDto } from './dto/compare-analysis-runs.dto';
import {
  AiAnalysisRunResponseDto,
  AiDatasetResponseDto,
  AiMessageVerificationResponseDto,
  AiReviewGroupVerificationResultResponseDto,
  AiReviewGroupsPageResponseDto,
  AiReviewQueueResponseDto,
  AiReviewSelectionVerificationResponseDto,
} from './ai-evidence-response.dto';

@ApiTags('intelligence-evidence')
@ApiBearerAuth('access-token')
@Controller('intelligence')
export class AiEvidenceController {
  constructor(private readonly evidence: AiEvidenceService) {}

  @Get('dataset')
  @ApiOkResponse({ type: AiDatasetResponseDto })
  dataset(@CurrentUser() user: { sub: string }) {
    return this.evidence.datasetSummary(user.sub);
  }

  @Get('review-queue')
  @ApiOkResponse({ type: AiReviewQueueResponseDto })
  reviewQueue(
    @CurrentUser() user: { sub: string },
    @Query() query: ReviewQueueQueryDto,
  ) {
    return this.evidence.reviewQueue(user.sub, query);
  }

  @Get('review-groups')
  @ApiOkResponse({ type: AiReviewGroupsPageResponseDto })
  reviewGroups(
    @CurrentUser() user: { sub: string },
    @Query() query: ReviewGroupsQueryDto,
  ) {
    return this.evidence.listReviewGroups(user.sub, query);
  }

  @Post('review-groups/verifications')
  @ApiCreatedResponse({ type: AiReviewGroupVerificationResultResponseDto })
  verifyReviewGroup(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateReviewGroupVerificationDto,
  ) {
    return this.evidence.verifyReviewGroup(user.sub, dto);
  }

  @Post('messages/verifications/batch')
  @ApiCreatedResponse({ type: AiReviewSelectionVerificationResponseDto })
  verifyReviewSelection(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateReviewSelectionVerificationDto,
  ) {
    return this.evidence.verifyReviewSelection(user.sub, dto);
  }

  @Post('messages/:messageId/verifications')
  @ApiCreatedResponse({ type: AiMessageVerificationResponseDto })
  verifyMessage(
    @CurrentUser() user: { sub: string },
    @Param('messageId') messageId: string,
    @Body() dto: CreateHumanVerificationDto,
  ) {
    return this.evidence.verifyMessage(user.sub, messageId, dto);
  }

  @Get('runs')
  @ApiOkResponse({ type: [AiAnalysisRunResponseDto] })
  runs(@CurrentUser() user: { sub: string }) {
    return this.evidence.listRuns(user.sub);
  }

  @Post('runs/evaluate')
  @ApiCreatedResponse({ type: AiAnalysisRunResponseDto })
  evaluate(@CurrentUser() user: { sub: string }) {
    return this.evidence.evaluateHoldout(user.sub);
  }

  @Post('runs/compare')
  @ApiBody({ type: CompareAnalysisRunsDto })
  compare(
    @CurrentUser() user: { sub: string },
    @Body() body: CompareAnalysisRunsDto,
  ) {
    return this.evidence.compareRuns(
      user.sub,
      body.firstRunId,
      body.secondRunId,
    );
  }
}
