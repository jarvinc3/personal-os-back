import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateReceivableDto } from './create-receivable.dto';

/** The collected amount moves only through payments, so it is not editable here. */
export class UpdateReceivableDto extends PartialType(
  OmitType(CreateReceivableDto, ['paidAmount'] as const),
) {}
