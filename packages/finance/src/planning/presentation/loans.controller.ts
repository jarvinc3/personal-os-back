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
import { PayNextLoanInstallmentUseCase } from '../application/pay-next-loan-installment.use-case';
import { PlanningService } from '../application/planning.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class LoansController {
  constructor(
    private readonly planning: PlanningService,
    private readonly payNextInstallment: PayNextLoanInstallmentUseCase,
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

  @Post('loans/:id/pay-next-installment')
  @ApiOperation({
    summary: 'Pay the oldest unpaid instalment and return the loan',
  })
  async payNext(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.payNextInstallment.execute(userId, id, new Date());
    return this.planning.getLoan(userId, id);
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
