import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CursorQueryDto } from '@personal-os/core';
import { PlanningService } from '../application/planning.service';
import { RecordReceivablePaymentUseCase } from '../application/record-receivable-payment.use-case';
import { ApplyReceivableCreditUseCase } from '../application/apply-receivable-credit.use-case';
import { WriteOffReceivableUseCase } from '../application/write-off-receivable.use-case';
import { ApplyReceivableCreditDto } from './dto/apply-receivable-credit.dto';
import { CreateReceivablePaymentDto } from './dto/create-receivable-payment.dto';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { WriteOffReceivableDto } from './dto/write-off-receivable.dto';
import {
  ReceivablePageResponseDto,
  ReceivablePaymentPageResponseDto,
  ReceivablePaymentResponseDto,
  ReceivableResponseDto,
} from './dto/receivable-response.dto';
import { SuccessResponseDto } from '../../shared/presentation/success-response.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class ReceivablesController {
  // One read service and one use case per action; a bundle would hide which
  // action each route calls.
  // eslint-disable-next-line max-params
  constructor(
    private readonly planning: PlanningService,
    private readonly recordPayment: RecordReceivablePaymentUseCase,
    private readonly applyCredit: ApplyReceivableCreditUseCase,
    private readonly writeOffReceivable: WriteOffReceivableUseCase,
  ) {}

  @Get('receivables')
  @ApiOperation({ summary: 'Lista los cobros (cursor)' })
  @ApiOkResponse({ type: ReceivablePageResponseDto })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.planning.listReceivablesPage(userId, query);
  }

  @Post('receivables')
  @ApiCreatedResponse({ type: ReceivableResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateReceivableDto) {
    return this.planning.createReceivable(userId, dto);
  }

  @Get('receivables/:id')
  @ApiOperation({ summary: 'Obtiene un cobro por id' })
  @ApiOkResponse({ type: ReceivableResponseDto })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getReceivable(userId, id);
  }

  @Get('receivables/:id/payments')
  @ApiOperation({
    summary: 'Pagos cobrados de un cobro, más recientes primero',
  })
  @ApiOkResponse({ type: ReceivablePaymentPageResponseDto })
  listPayments(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.planning.listReceivablePayments(userId, id, query);
  }

  @Post('receivables/:id/payments')
  @ApiOperation({
    summary: 'Cobra un pago y registra el ingreso en la cuenta indicada',
  })
  @ApiCreatedResponse({ type: ReceivablePaymentResponseDto })
  addPayment(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateReceivablePaymentDto,
  ) {
    return this.recordPayment.execute({
      userId,
      receivableId: id,
      dto,
      now: new Date(),
    });
  }

  @Post('receivables/:id/credit')
  @ApiOperation({ summary: 'Aplica el saldo a favor de un cobro a otro' })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  applyCreditBalance(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ApplyReceivableCreditDto,
  ) {
    return this.applyCredit.execute({
      userId,
      sourceReceivableId: id,
      dto,
      now: new Date(),
    });
  }

  @Post('receivables/:id/write-off')
  @ApiOperation({ summary: 'Da de baja un cobro incobrable' })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  async writeOff(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: WriteOffReceivableDto,
  ) {
    await this.writeOffReceivable.execute({
      userId,
      receivableId: id,
      command: dto,
      now: new Date(),
    });
    return { success: true };
  }

  @Patch('receivables/:id')
  @ApiOkResponse({ type: ReceivableResponseDto })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReceivableDto,
  ) {
    return this.planning.updateReceivable(userId, id, dto);
  }

  @Delete('receivables/:id')
  @ApiOperation({ summary: 'Borra un cobro de forma definitiva' })
  @ApiOkResponse({ type: SuccessResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteReceivable(userId, id);
  }

  @Post('receivables/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreReceivable(userId, id, new Date());
  }
}
