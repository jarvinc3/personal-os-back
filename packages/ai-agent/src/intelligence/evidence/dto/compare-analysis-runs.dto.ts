import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CompareAnalysisRunsDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  firstRunId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  secondRunId!: string;
}
