import { ApiProperty } from '@nestjs/swagger';

const DATA_APPS = ['finance', 'ai', 'notifications', 'settings'] as const;

export class UserModuleResponseDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty()
  isEnabled!: boolean;

  @ApiProperty({ type: Object })
  config!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  enabledAt!: string;
}

export class UserProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ nullable: true, type: String })
  avatarUrl!: string | null;

  @ApiProperty()
  timezone!: string;

  @ApiProperty()
  locale!: string;

  @ApiProperty({ type: Object })
  preferences!: Record<string, unknown>;

  @ApiProperty({ nullable: true, type: String })
  lastSeenReleaseVersion!: string | null;

  @ApiProperty({ type: () => [UserModuleResponseDto] })
  userModules!: UserModuleResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DeleteAccountResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty()
  authCleanupPending!: boolean;
}

export class DataBranchIncludeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  count!: number;
}

export class DataBranchCountResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty({ type: () => [DataBranchIncludeResponseDto] })
  includes!: DataBranchIncludeResponseDto[];
}

export class DataAppBranchesResponseDto {
  @ApiProperty({ enum: DATA_APPS })
  app!: string;

  @ApiProperty({ type: () => [DataBranchCountResponseDto] })
  branches!: DataBranchCountResponseDto[];
}

export class WipeUserDataResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: [String] })
  requestedBranches!: string[];

  @ApiProperty({ type: [String] })
  appliedBranches!: string[];

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  counts!: Record<string, number>;
}
