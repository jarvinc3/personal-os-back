import { ApiProperty } from '@nestjs/swagger';

const NOTIFICATION_CHANNELS = ['PUSH', 'IN_APP', 'EMAIL'] as const;

export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: NOTIFICATION_CHANNELS })
  channel!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: Object })
  data!: Record<string, unknown>;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  scheduledAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  sentAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class NotificationPageResponseDto {
  @ApiProperty({ type: () => [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class UnreadNotificationsResponseDto {
  @ApiProperty()
  count!: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty()
  updated!: number;
}

export class PushTokenResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  platform!: string;

  @ApiProperty()
  token!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class NotificationSuccessResponseDto {
  @ApiProperty()
  success!: boolean;
}
