import { ApiProperty } from '@nestjs/swagger';
import { TransactionResponseDto } from '../../../shared/presentation/dto/transaction-response.dto';

export class AdjustBalanceResponseDto {
  @ApiProperty()
  adjusted!: boolean;

  @ApiProperty({ example: 1500 })
  balance!: number;

  @ApiProperty({ type: () => TransactionResponseDto, nullable: true })
  transaction!: TransactionResponseDto | null;
}
