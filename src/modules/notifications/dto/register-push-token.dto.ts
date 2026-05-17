import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';

const platforms = ['ios', 'android'] as const;

export class RegisterPushTokenDto {
  @ApiProperty({ enum: platforms })
  @IsIn(platforms)
  platform!: (typeof platforms)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  token!: string;
}
