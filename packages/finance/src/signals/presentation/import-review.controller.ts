import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { ImportReviewResolutionService } from '../import-review-resolution.service';
import {
  ImportReviewItemResponseDto,
  ImportReviewResolutionResponseDto,
} from './dto/import-review-response.dto';
import { ResolveImportReviewDto } from './dto/resolve-import-review.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/imports/review')
export class ImportReviewController {
  constructor(private readonly resolutions: ImportReviewResolutionService) {}

  @Get()
  @ApiOperation({
    summary: 'Imports de correo que esperan una decisión humana',
  })
  @ApiOkResponse({ type: [ImportReviewItemResponseDto] })
  list(@CurrentUser('sub') userId: string) {
    return this.resolutions.listForUser(userId);
  }

  @Post(':id/resolve')
  @ApiOperation({
    summary: 'Fija fecha o destino, enlaza el reverso o descarta un import',
  })
  @ApiOkResponse({ type: ImportReviewResolutionResponseDto })
  resolve(
    @CurrentUser('sub') userId: string,
    @Param('id') importId: string,
    @Body() dto: ResolveImportReviewDto,
  ) {
    return this.resolutions.resolve({ userId, importId, input: dto });
  }
}
