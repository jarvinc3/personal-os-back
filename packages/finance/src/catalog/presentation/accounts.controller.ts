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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CursorQueryDto,
  RequiresEnabledModule,
} from '@personal-os/core';
import { CatalogService } from '../application/catalog.service';
import { InstrumentHistoryService } from '../application/instrument-history.service';
import { CreateAccountDto } from './dto/create-account.dto';
import {
  AccountPageResponseDto,
  AccountResponseDto,
  InstrumentHistoryPageResponseDto,
} from './dto/account-response.dto';
import { SuccessResponseDto } from '../../shared/presentation/success-response.dto';
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
  @ApiOperation({ summary: 'Lista las cuentas de finanzas (cursor)' })
  @ApiOkResponse({ type: AccountPageResponseDto })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.catalog.listAccountsPage(userId, query);
  }

  @Post('accounts')
  @ApiCreatedResponse({ type: AccountResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateAccountDto) {
    return this.catalog.createAccount(userId, dto);
  }

  @Get('accounts/:id')
  @ApiOkResponse({ type: AccountResponseDto })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.getAccount(userId, id);
  }

  @Get('accounts/:id/history')
  @ApiOperation({
    summary: 'Cronología de la cuenta: ajustes y cambios de límite',
  })
  @ApiOkResponse({ type: InstrumentHistoryPageResponseDto })
  getHistory(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.history.getAccountHistory(userId, id, query);
  }

  @Patch('accounts/:id')
  @ApiOkResponse({ type: AccountResponseDto })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.catalog.updateAccount(userId, id, dto);
  }

  @Delete('accounts/:id')
  @ApiOperation({
    summary:
      'Borra de forma definitiva la cuenta, sus tarjetas de débito y sus movimientos',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deleteAccount(userId, id);
  }

  @Post('accounts/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  @ApiOkResponse({ type: SuccessResponseDto })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.restoreAccount(userId, id, new Date());
  }
}
