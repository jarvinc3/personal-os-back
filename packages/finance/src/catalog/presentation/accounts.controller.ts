import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CursorQueryDto,
  RequiresEnabledModule,
} from '@personal-os/core';
import { CatalogService } from '../application/catalog.service';
import { InstrumentHistoryService } from '../application/instrument-history.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class AccountsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly history: InstrumentHistoryService,
  ) {}

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

  @Get('accounts/:id/history')
  @ApiOperation({ summary: 'Account timeline: adjustments and limit changes' })
  getHistory(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.history.getAccountHistory(userId, id, query);
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

  @Post('accounts/:id/restore')
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.restoreAccount(userId, id, new Date());
  }
}
