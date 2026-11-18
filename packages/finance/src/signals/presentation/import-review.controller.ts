import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule, Timeout } from '@personal-os/core';
import { ImportReviewResolutionService } from '../import-review-resolution.service';
import {
  ImportReviewItemResponseDto,
  ImportReviewResolutionResponseDto,
} from './dto/import-review-response.dto';
import { ResolveImportReviewDto } from './dto/resolve-import-review.dto';

/**
 * El consumidor puede esperar una tasa FX de hasta 10 s al importar moneda
 * distinta; el límite global de 5 s cortaría la respuesta con el movimiento ya
 * escrito. El margen cubre la transacción de resolución.
 */
const RESOLVE_IMPORT_TIMEOUT_MS = 30_000;

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
  @Timeout(RESOLVE_IMPORT_TIMEOUT_MS)
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
