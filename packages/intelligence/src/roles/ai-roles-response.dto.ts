import { ApiProperty } from '@nestjs/swagger';
import { AI_ROLES } from './ai-role.decorator';

export class AiRoleUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ enum: AI_ROLES })
  role!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  grantedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  updatedAt!: string | null;
}

export class AiRoleAssignmentResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: AI_ROLES })
  role!: string;

  @ApiProperty({ nullable: true, type: String })
  grantedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  grantedAt!: string;
}
