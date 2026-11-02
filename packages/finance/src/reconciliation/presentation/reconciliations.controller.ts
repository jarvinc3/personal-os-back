import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { ReconciliationsService } from '../application/reconciliations.service';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import { ListReconciliationsQueryDto } from './dto/list-reconciliations-query.dto';
import { PreviewReconciliationDto } from './dto/preview-reconciliation.dto';
import { ReconciliationStatusQueryDto } from './dto/reconciliation-status-query.dto';
import {
  ReconciliationPageResponseDto,
  ReconciliationPreviewResponseDto,
  ReconciliationResponseDto,
  ReconciliationStatusResponseDto,
} from './dto/reconciliation-response.dto';
import {
  DeleteResponseDto,
  SuccessResponseDto,
} from '../../shared/presentation/success-response.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/reconciliations')
export class ReconciliationsController {
  constructor(private readonly reconciliations: ReconciliationsService) {}

  @Post('preview')
  @ApiOperation({
    summary: 'Vista previa de un cierre: saldo, diferencia y sugerencia',
  })
  @ApiCreatedResponse({ type: ReconciliationPreviewResponseDto })
  preview(
    @CurrentUser('sub') userId: string,
    @Body() dto: PreviewReconciliationDto,
  ) {
    return this.reconciliations.preview(userId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Cierra un producto y crea sus ajustes' })
  @ApiCreatedResponse({ type: ReconciliationResponseDto })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateReconciliationDto,
  ) {
    return this.reconciliations.create(userId, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Productos conciliados y pendientes de un mes' })
  @ApiOkResponse({ type: ReconciliationStatusResponseDto })
  status(
    @CurrentUser('sub') userId: string,
    @Query() query: ReconciliationStatusQueryDto,
  ) {
    return this.reconciliations.status(userId, query.month);
  }

  @Get()
  @ApiOperation({
    summary: 'Historial de conciliaciones de una cuenta o tarjeta',
  })
  @ApiOkResponse({ type: ReconciliationPageResponseDto })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListReconciliationsQueryDto,
  ) {
    return this.reconciliations.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de la conciliación' })
  @ApiOkResponse({ type: ReconciliationResponseDto })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.reconciliations.get(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Borra el último cierre de un producto' })
  @ApiOkResponse({ type: DeleteResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.reconciliations.remove(userId, id);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Deshace el borrado de una conciliación' })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.reconciliations.restore(userId, id);
  }
}
