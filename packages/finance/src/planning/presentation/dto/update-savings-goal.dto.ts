import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSavingsGoalDto } from './create-savings-goal.dto';

/** The balance moves only through contributions, so it is not editable here. */
export class UpdateSavingsGoalDto extends PartialType(
  OmitType(CreateSavingsGoalDto, ['currentAmount'] as const),
) {}
