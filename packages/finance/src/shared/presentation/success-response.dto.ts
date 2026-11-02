import { ApiProperty } from '@nestjs/swagger';

export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}

export class DeleteResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ description: 'Id para deshacer el borrado' })
  undoId!: string;
}
