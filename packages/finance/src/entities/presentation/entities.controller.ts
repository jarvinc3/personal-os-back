import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { FinanceEntityLookupService } from '../application/finance-entity-lookup.service';
import { LookupEntitiesDto } from './dto/lookup-entities.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/entities')
export class EntitiesController {
  constructor(private readonly lookup: FinanceEntityLookupService) {}

  @Post('lookup')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resuelve entidades de Finanzas por referencia, en lote',
    description:
      'Returns the same public representation as each entity endpoint, in the same order as the references. A reference the user cannot see, or that no longer exists, comes back as null in its position. Read-only: it does not record activity.',
  })
  lookupEntities(
    @CurrentUser('sub') userId: string,
    @Body() dto: LookupEntitiesDto,
  ) {
    return this.lookup.lookup(userId, dto.refs);
  }
}
