import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CatalogService } from '../application/catalog.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class AccountsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'List finance accounts' })
  list(@CurrentUser('sub') userId: string) {
    return this.catalog.listAccounts(userId);
  }

  @Post('accounts')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateAccountDto) {
    return this.catalog.createAccount(userId, dto);
  }

  @Get('accounts/:id')
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.getAccount(userId, id);
  }

  @Patch('accounts/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.catalog.updateAccount(userId, id, dto);
  }

  @Delete('accounts/:id')
  @ApiOperation({
    summary: 'Hard-delete account, debit cards, and ledger rows',
  })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deleteAccount(userId, id);
  }
}
