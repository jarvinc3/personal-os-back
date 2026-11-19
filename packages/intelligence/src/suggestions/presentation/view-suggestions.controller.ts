import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { ViewSuggestionsService } from '../application/view-suggestions.service';
import {
  ViewSuggestionDismissedDto,
  ViewSuggestionsListDto,
  ViewSuggestionsQueryDto,
} from './dto/view-suggestion.dto';

@ApiTags('intelligence-view-suggestions')
@ApiBearerAuth('access-token')
@Controller('intelligence/view-suggestions')
export class ViewSuggestionsController {
  constructor(private readonly suggestions: ViewSuggestionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las sugerencias activas de la vista del usuario',
  })
  @ApiOkResponse({ type: ViewSuggestionsListDto })
  @ApiBadRequestResponse({
    description: 'Ruta o vista inválida, o vista y sheet a la vez',
  })
  async resolveForView(
    @CurrentUser('sub') userId: string,
    @Query() query: ViewSuggestionsQueryDto,
  ) {
    return {
      suggestions: await this.suggestions.resolveForView({
        userId,
        route: query.route,
        view: query.view,
        sheet: query.sheet,
      }),
    };
  }

  @Delete(':suggestionId')
  @ApiOperation({
    summary: 'Descartar una sugerencia propia de forma persistente',
  })
  @ApiOkResponse({ type: ViewSuggestionDismissedDto })
  @ApiNotFoundResponse({ description: 'Sugerencia no encontrada' })
  async dismiss(
    @CurrentUser('sub') userId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    await this.suggestions.dismiss({ userId, suggestionId });
    return { dismissed: true };
  }
}
