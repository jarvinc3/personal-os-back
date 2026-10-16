import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

const RELEASE_VERSION_MAX_LENGTH = 32;
const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export class MarkReleaseNotesSeenDto {
  @ApiProperty({ example: '0.20.0', description: 'Versión de Novedades vista' })
  @IsString()
  @MaxLength(RELEASE_VERSION_MAX_LENGTH)
  @Matches(RELEASE_VERSION_PATTERN, {
    message: 'version debe tener el formato X.Y.Z',
  })
  version!: string;
}
