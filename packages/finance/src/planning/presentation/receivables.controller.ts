import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { PlanningService } from '../application/planning.service';
import { RecordReceivablePaymentUseCase } from '../application/record-receivable-payment.use-case';
import { WriteOffReceivableUseCase } from '../application/write-off-receivable.use-case';
import { CreateReceivablePaymentDto } from './dto/create-receivable-payment.dto';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { WriteOffReceivableDto } from './dto/write-off-receivable.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class ReceivablesController {
  constructor(
    private readonly planning: PlanningService,
    private readonly recordPayment: RecordReceivablePaymentUseCase,
    private readonly writeOffReceivable: WriteOffReceivableUseCase,
  ) {}

  @Get('receivables')
  list(@CurrentUser('sub') userId: string) {
    return this.planning.listReceivables(userId);
  }

  @Post('receivables')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateReceivableDto) {
    return this.planning.createReceivable(userId, dto);
  }

  @Get('receivables/:id')
  @ApiOperation({ summary: 'Get receivable by id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getReceivable(userId, id);
  }

  @Get('receivables/:id/payments')
  @ApiOperation({
    summary: 'Payments collected for a receivable, newest first',
  })
  listPayments(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.listReceivablePayments(userId, id);
  }

  @Post('receivables/:id/payments')
  @ApiOperation({
    summary: 'Collect a payment and record the income on the given account',
  })
  addPayment(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateReceivablePaymentDto,
  ) {
    return this.recordPayment.execute(userId, id, dto, new Date());
  }

  @Post('receivables/:id/write-off')
  @ApiOperation({ summary: 'Write off an uncollectible receivable' })
  async writeOff(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: WriteOffReceivableDto,
  ) {
    await this.writeOffReceivable.execute(userId, id, dto, new Date());
    return { success: true };
  }

  @Patch('receivables/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
  ) {
    return this.planning.updateReceivable(userId, id, dto);
  }

  @Delete('receivables/:id')
  @ApiOperation({ summary: 'Hard-delete receivable' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteReceivable(userId, id);
  }

  @Post('receivables/:id/restore')
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreReceivable(userId, id, new Date());
  }
}
