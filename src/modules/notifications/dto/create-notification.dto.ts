import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const notificationChannels = ['IN_APP', 'PUSH', 'EMAIL'] as const;

export class CreateNotificationDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  type!: string;

  @ApiProperty({ enum: notificationChannels, default: 'IN_APP' })
  @IsEnum(notificationChannels)
  channel!: (typeof notificationChannels)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  body!: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
