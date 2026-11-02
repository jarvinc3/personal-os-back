import { ApiProperty } from '@nestjs/swagger';

const GOAL_MODES = ['EARMARK', 'DEDICATED'] as const;
const ALLOCATION_KINDS = ['CONTRIBUTION', 'WITHDRAWAL'] as const;

export class SavingsGoalResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ example: '1500.00' })
  targetAmount!: string;

  @ApiProperty({ example: '1500.00' })
  currentAmount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  targetDate!: string | null;

  @ApiProperty({ nullable: true, type: String })
  icon!: string | null;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ enum: GOAL_MODES })
  mode!: string;

  @ApiProperty()
  spendReducesProgress!: boolean;

  @ApiProperty()
  isCompleted!: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class SavingsGoalPageResponseDto {
  @ApiProperty({ type: () => [SavingsGoalResponseDto] })
  items!: SavingsGoalResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class SavingsGoalContributionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  goalId!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ format: 'date-time' })
  contributedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  destinationAccountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;

  @ApiProperty({ enum: ALLOCATION_KINDS })
  kind!: string;

  @ApiProperty({ nullable: true, type: String })
  transferGroupId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class SavingsGoalContributionPageResponseDto {
  @ApiProperty({ type: () => [SavingsGoalContributionResponseDto] })
  items!: SavingsGoalContributionResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
