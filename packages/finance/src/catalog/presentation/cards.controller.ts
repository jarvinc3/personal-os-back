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
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardBalanceDto } from './dto/update-card-balance.dto';
import { UpdateCardCreditLimitDto } from './dto/update-card-credit-limit.dto';
import { UpdateCardDto } from './dto/update-card.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CardsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly history: InstrumentHistoryService,
  ) {}

  @Get('cards')
  list(@CurrentUser('sub') userId: string) {
    return this.catalog.listCards(userId);
  }

  @Post('cards')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateCardDto) {
    return this.catalog.createCard(userId, dto);
  }

  @Get('cards/:id')
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.getCard(userId, id);
  }

  @Get('cards/:id/history')
  @ApiOperation({ summary: 'Card timeline: adjustments and limit changes' })
  getHistory(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.history.getCardHistory(userId, id, query);
  }

  @Patch('cards/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardDto,
  ) {
    return this.catalog.updateCard(userId, id, dto);
  }

  @Delete('cards/:id')
  @ApiOperation({ summary: 'Hard-delete card and its ledger rows' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deleteCard(userId, id);
  }

  @Post('cards/:id/restore')
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.restoreCard(userId, id, new Date());
  }

  @Post('cards/:id/balances/credit-limit')
  @ApiOperation({
    summary: 'Update a credit card limit without changing its balance',
  })
  updateCreditLimit(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardCreditLimitDto,
  ) {
    return this.catalog.updateCardCreditLimit(userId, id, dto);
  }

  @Post('cards/:id/balances')
  updateBalance(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardBalanceDto,
  ) {
    return this.catalog.updateCardBalance(userId, id, dto);
  }

  @Delete('cards/:id/balances/:currency')
  @ApiOperation({ summary: 'Delete one stored currency from a card' })
  deleteBalance(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('currency') currency: string,
  ) {
    return this.catalog.deleteCardBalance(userId, id, currency);
  }
}
