import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionResponseDto } from './transaction-response.dto';

export class TransferResponseDto {
  @ApiProperty()
  transferGroupId!: string;

  @ApiProperty({ type: () => TransactionResponseDto })
  debit!: TransactionResponseDto;

  @ApiProperty({ type: () => TransactionResponseDto })
  credit!: TransactionResponseDto;

  @ApiPropertyOptional({ type: String })
  suggestGoalId?: string;
}
