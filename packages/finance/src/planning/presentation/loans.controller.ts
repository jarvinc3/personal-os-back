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
  list(@CurrentUser('sub') userId: string) {
    return this.planning.listLoans(userId);
  }

  @Post('loans')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateLoanDto) {
    return this.planning.createLoan(userId, dto, new Date());
  }

  @Get('loans/:id')
  @ApiOperation({ summary: 'Get loan by id' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.getLoan(userId, id);
  }

  @Get('loans/:id/installments')
  @ApiOperation({ summary: 'Instalment schedule of a loan, oldest first' })
  listInstallments(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.planning.listLoanInstallments(userId, id);
  }

  @Get('loans/:id/schedule')
  @ApiOperation({ summary: 'Full instalment projection of a loan' })
  schedule(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.listLoanInstallments(userId, id);
  }

  @Post('loans/:id/pay-next-installment')
  @ApiOperation({
    summary: 'Pay the oldest unpaid instalment and return the breakdown',
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
    summary: 'Pay a capital prepayment and rebuild the schedule',
  })
  async prepay(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: LoanPrepaymentDto,
  ) {
    const prepayment = await this.applyPrepayment.execute(
      userId,
      id,
      new Date(),
      dto,
    );
    return {
      prepayment,
      loan: await this.planning.getLoan(userId, id),
      schedulePreview: await this.planning.listLoanInstallments(userId, id),
    };
  }

  @Get('loans/:id/prepayments/preview')
  @ApiOperation({ summary: 'Preview a prepayment without writing' })
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
  @ApiOperation({ summary: 'Hard-delete loan' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deleteLoan(userId, id);
  }

  @Post('loans/:id/restore')
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.restoreLoan(userId, id, new Date());
  }
}
