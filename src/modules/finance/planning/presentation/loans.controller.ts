import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../core/decorators';
import { PlanningService } from '../application/planning.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
export class LoansController {
  constructor(private readonly planning: PlanningService) {}

  @Get('loans')
  list(@CurrentUser('sub') userId: string) {
    return this.planning.listLoans(userId);
  }

  @Post('loans')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateLoanDto) {
    return this.planning.createLoan(userId, dto);
  }

  @Patch('loans/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.planning.updateLoan(userId, id, dto);
  }

  @Delete('loans/:id')
  @ApiOperation({ summary: 'Deactivate loan (soft archive)' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.planning.deactivateLoan(userId, id);
  }
}
