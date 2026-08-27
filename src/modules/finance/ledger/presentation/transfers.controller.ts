import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequiresEnabledModule,
} from '../../../../core/decorators';
import { CreateTransferUseCase } from '../application/create-transfer.use-case';
import { CreateTransferDto } from './dto/create-transfer.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class TransfersController {
  constructor(private readonly createTransfer: CreateTransferUseCase) {}

  @Post('transfers')
  @ApiOperation({ summary: 'Create a transfer between accounts/cards' })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateTransferDto) {
    return this.createTransfer.execute(userId, dto);
  }
}
