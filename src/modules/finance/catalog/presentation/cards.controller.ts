import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../core/decorators';
import { CatalogService } from '../application/catalog.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardBalanceDto } from './dto/update-card-balance.dto';
import { UpdateCardDto } from './dto/update-card.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
export class CardsController {
  constructor(private readonly catalog: CatalogService) {}

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

  @Patch('cards/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardDto,
  ) {
    return this.catalog.updateCard(userId, id, dto);
  }

  @Post('cards/:id/balances')
  updateBalance(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardBalanceDto,
  ) {
    return this.catalog.updateCardBalance(userId, id, dto);
  }
}
