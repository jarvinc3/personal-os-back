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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CursorQueryDto } from '@personal-os/core';
import { ApplyLoanPrepaymentUseCase } from '../application/apply-loan-prepayment.use-case';
import { PayNextLoanInstallmentUseCase } from '../application/pay-next-loan-installment.use-case';
import { PlanningService } from '../application/planning.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import {
  LoanPrepaymentDto,
  LoanPrepaymentPreviewDto,
} from './dto/loan-prepayment.dto';
import { PayLoanInstallmentDto } from './dto/pay-loan-installment.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class LoansController {
  constructor(
    private readonly planning: PlanningService,
    private readonly payNextInstallment: PayNextLoanInstallmentUseCase,
    private readonly applyPrepayment: ApplyLoanPrepaymentUseCase,
  ) {}

  @Get('loans')
  @ApiOperation({ summary: 'Lista los préstamos activos (cursor)' })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.planning.listLoansPage(userId, query);
  }

  @Post('loans')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateLoanDto) {
    return this.planning.createLoan(userId, dto, new Date());
  }

  @Get('loans/:id')
  @ApiOperation({ summary: 'Obtiene un préstamo por id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getLoan(userId, id);
  }

  @Get('loans/:id/installments')
  @ApiOperation({
    summary:
      'Cuotas de un préstamo, más antiguas primero (paginado por cursor)',
  })
  listInstallments(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.planning.listLoanInstallmentsPage(userId, id, query);
  }

  @Get('loans/:id/schedule')
  @ApiOperation({ summary: 'Proyección completa de cuotas de un préstamo' })
  schedule(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.listLoanInstallments(userId, id);
  }

  @Post('loans/:id/pay-next-installment')
  @ApiOperation({
    summary: 'Paga la cuota impaga más antigua y devuelve el desglose',
  })
  payNext(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: PayLoanInstallmentDto,
  ) {
    return this.payNextInstallment.execute(userId, id, new Date(), dto);
  }

  @Post('loans/:id/prepayments')
  @ApiOperation({
    summary: 'Paga un prepago de capital y reconstruye el calendario',
  })
  prepay(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: LoanPrepaymentDto,
  ) {
    return this.applyPrepayment.execute(userId, id, new Date(), dto);
  }

  @Get('loans/:id/prepayments/preview')
  @ApiOperation({ summary: 'Vista previa de un prepago sin guardar' })
  preview(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: LoanPrepaymentPreviewDto,
  ) {
    return this.applyPrepayment.preview(userId, id, query.amount, query.mode);
  }

  @Patch('loans/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.planning.updateLoan(userId, id, dto, new Date());
  }

  @Delete('loans/:id')
  @ApiOperation({ summary: 'Borra un préstamo de forma definitiva' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteLoan(userId, id);
  }

  @Post('loans/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreLoan(userId, id, new Date());
  }
}
