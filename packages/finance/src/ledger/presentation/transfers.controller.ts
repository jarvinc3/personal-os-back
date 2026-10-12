import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CreateTransferUseCase } from '../application/create-transfer.use-case';
import { UpdateTransferUseCase } from '../application/update-transfer.use-case';
import { CreateTransferDto } from './dto/create-transfer.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class TransfersController {
  constructor(
    private readonly createTransfer: CreateTransferUseCase,
    private readonly updateTransfer: UpdateTransferUseCase,
  ) {}

  @Post('transfers')
  @ApiOperation({
    summary: 'Create a transfer from an account to an account or card',
  })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateTransferDto) {
    return this.createTransfer.execute(userId, dto);
  }

  @Patch('transfers/:id')
  @ApiOperation({
    summary: 'Replace both legs of a transfer by one of its leg ids',
  })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateTransferDto,
  ) {
    return this.updateTransfer.execute(userId, id, dto);
  }
}
