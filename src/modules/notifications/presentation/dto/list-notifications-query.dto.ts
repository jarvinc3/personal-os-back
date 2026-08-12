import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../../core/pagination/pagination.dto';

const channels = ['IN_APP', 'PUSH', 'EMAIL'] as const;

export class ListNotificationsQueryDto extends PaginationQueryDto {
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
