import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CardStatementsService } from '../application/card-statements.service';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CardStatementsController {
  constructor(private readonly statements: CardStatementsService) {}

  @Get('cards/:id/statements')
  @ApiOperation({ summary: 'Closed billing statements of a credit card' })
  list(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.statements.listCardStatements(userId, id, new Date());
  }
}
