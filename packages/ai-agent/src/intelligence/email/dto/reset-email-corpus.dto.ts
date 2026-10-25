import { Equals, IsBoolean } from 'class-validator';

export class ResetEmailCorpusDto {
  @IsBoolean()
  @Equals(true)
  confirmed!: boolean;
}
