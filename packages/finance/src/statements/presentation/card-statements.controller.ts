import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CursorQueryDto } from '@personal-os/core';
import { CardStatementsService } from '../application/card-statements.service';
import { UpdateCardStatementDto } from './dto/update-card-statement.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CardStatementsController {
  constructor(private readonly statements: CardStatementsService) {}

  @Get('cards/:id/statements')
  @ApiOperation({ summary: 'Billing statements of a credit card' })
  list(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.statements.listCardStatements(userId, id, query, new Date());
  }

  @Get('cards/:id/statements/:statementId')
  @ApiOperation({ summary: 'Statement detail with its movements and payments' })
  detail(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('statementId') statementId: string,
  ) {
    return this.statements.getStatementDetail(
      userId,
      id,
      statementId,
      new Date(),
    );
  }

  @Patch('cards/:id/statements/:statementId')
  @ApiOperation({
    summary: 'Edit a statement minimum, closing balance or due date',
  })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('statementId') statementId: string,
    @Body() dto: UpdateCardStatementDto,
  ) {
    return this.statements
      .updateStatement(userId, id, statementId, dto)
      .then(() => ({ success: true }));
  }
}
