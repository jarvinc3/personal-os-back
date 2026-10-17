import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { ReceivableSharesService } from '../application/receivable-shares.service';
import { CreateReceivableShareDto } from './dto/create-receivable-share.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/receivable-shares')
export class ReceivableSharesController {
  constructor(private readonly shares: ReceivableSharesService) {}

  @Post()
  @ApiOperation({ summary: 'Crea un link público de solo lectura' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateReceivableShareDto,
  ) {
    return this.shares.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista los links del usuario, activos y revocados' })
  list(@CurrentUser('sub') userId: string) {
    return this.shares.list(userId);
  }

  @Patch(':id/revoke')
  @ApiOperation({ summary: 'Revoca el link; deja de resolver' })
  revoke(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.shares.revoke(userId, id, new Date());
  }

  @Patch(':id/regenerate')
  @ApiOperation({ summary: 'Rota el token y reactiva el link' })
  regenerate(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.shares.regenerate(userId, id);
  }
}
