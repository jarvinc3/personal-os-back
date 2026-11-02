import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CursorQueryDto } from '@personal-os/core';
import { CardStatementsService } from '../application/card-statements.service';
import {
  CardStatementDetailResponseDto,
  CardStatementPageResponseDto,
} from './dto/statement-response.dto';
import { SuccessResponseDto } from '../../shared/presentation/success-response.dto';
import { UpdateCardStatementDto } from './dto/update-card-statement.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CardStatementsController {
  constructor(private readonly statements: CardStatementsService) {}

  @Get('cards/:id/statements')
  @ApiOperation({ summary: 'Estados de facturación de una tarjeta de crédito' })
  @ApiOkResponse({ type: CardStatementPageResponseDto })
  list(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.statements.listCardStatements(userId, id, query, new Date());
  }

  @Get('cards/:id/statements/:statementId')
  @ApiOperation({
    summary: 'Detalle del estado de cuenta con movimientos y pagos',
  })
  @ApiOkResponse({ type: CardStatementDetailResponseDto })
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
    summary:
      'Edita el mínimo, el saldo de cierre o el vencimiento del estado de cuenta',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
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
