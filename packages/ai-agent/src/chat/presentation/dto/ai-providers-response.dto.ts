import { ApiProperty } from '@nestjs/swagger';
import { AiProviderInfoDto } from './ai-provider-info.dto';

export class AiProvidersResponseDto {
  @ApiProperty({ type: () => AiProviderInfoDto, isArray: true })
  providers!: AiProviderInfoDto[];
}
