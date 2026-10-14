import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { ReconciliationsService } from '../application/reconciliations.service';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import { ListReconciliationsQueryDto } from './dto/list-reconciliations-query.dto';
import { PreviewReconciliationDto } from './dto/preview-reconciliation.dto';
import { ReconciliationStatusQueryDto } from './dto/reconciliation-status-query.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/reconciliations')
export class ReconciliationsController {
  constructor(private readonly reconciliations: ReconciliationsService) {}

  @Post('preview')
  @ApiOperation({ summary: 'Preview a close: balance, difference, suggestion' })
  preview(
    @CurrentUser('sub') userId: string,
    @Body() dto: PreviewReconciliationDto,
  ) {
    return this.reconciliations.preview(userId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Close a product and create its adjustments' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateReconciliationDto,
  ) {
    return this.reconciliations.create(userId, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Products reconciled and pending for a month' })
  status(
    @CurrentUser('sub') userId: string,
    @Query() query: ReconciliationStatusQueryDto,
  ) {
    return this.reconciliations.status(userId, query.month);
  }

  @Get()
  @ApiOperation({ summary: 'Reconciliation history of an account or card' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListReconciliationsQueryDto,
  ) {
    return this.reconciliations.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reconciliation detail' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.reconciliations.get(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete the latest close of a product' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.reconciliations.remove(userId, id);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Undo a reconciliation delete' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.reconciliations.restore(userId, id);
  }
}
