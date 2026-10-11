import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { CursorQueryDto } from '@personal-os/core';

const channels = ['IN_APP', 'PUSH', 'EMAIL'] as const;

export class ListNotificationsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: channels, default: 'IN_APP' })
  @IsOptional()
  @IsEnum(channels)
  channel?: (typeof channels)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}
