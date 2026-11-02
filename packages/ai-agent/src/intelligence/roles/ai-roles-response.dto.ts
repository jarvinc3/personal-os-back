import { ApiProperty } from '@nestjs/swagger';

const AI_USER_ROLES = ['USER', 'CONTRIBUTOR', 'ADMIN'] as const;

export class AiRoleUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ enum: AI_USER_ROLES })
  role!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  grantedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  updatedAt!: string | null;
}

export class AiRoleAssignmentResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: AI_USER_ROLES })
  role!: string;

  @ApiProperty({ nullable: true, type: String })
  grantedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  grantedAt!: string;
}
