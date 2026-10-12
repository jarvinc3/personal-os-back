import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { LoanFieldsDto } from './loan-fields.dto';

/**
 * Editing is validated field by field here; the cross-field rules need the
 * stored loan, so PlanningService.updateLoan owns them.
 */
export class UpdateLoanDto extends PartialType(LoanFieldsDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
