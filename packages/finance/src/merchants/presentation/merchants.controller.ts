import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import type { LogoUploadFile } from '@personal-os/logos';
import { MerchantsService } from '../application/merchants.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { ListMerchantsQueryDto } from './dto/list-merchants-query.dto';
import { MergeMerchantDto } from './dto/merge-merchant.dto';
import { SuggestMerchantQueryDto } from './dto/suggest-merchant-query.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get('merchants')
  @ApiOperation({ summary: 'Lista los comercios con su gasto del mes' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListMerchantsQueryDto,
  ) {
    return this.merchants.list(userId, query);
  }

  @Get('merchants/suggest')
  @ApiOperation({ summary: 'Mejor comercio conocido para un nombre escrito' })
  suggest(
    @CurrentUser('sub') userId: string,
    @Query() query: SuggestMerchantQueryDto,
  ) {
    return this.merchants.suggest(userId, query.merchant);
  }

  @Post('merchants')
  @ApiOperation({ summary: 'Crea un comercio con nombre, categoría y alias' })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateMerchantDto) {
    return this.merchants.create(userId, dto);
  }

  @Get('merchants/:id')
  @ApiOperation({ summary: 'Detalle del comercio' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.merchants.get(userId, id);
  }

  @Get('merchants/:id/duplicates')
  @ApiOperation({
    summary: 'Comercios que parecen el mismo, con el motivo',
  })
  duplicates(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.merchants.duplicates(userId, id);
  }

  @Patch('merchants/:id')
  @ApiOperation({
    summary: 'Renombra un comercio o define su categoría y logo',
  })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMerchantDto,
  ) {
    return this.merchants.update(userId, id, dto);
  }

  @Post('merchants/:id/merge')
  @ApiOperation({ summary: 'Mueve los movimientos de un comercio a otro' })
  merge(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: MergeMerchantDto,
  ) {
    return this.merchants.merge(userId, id, dto.targetId);
  }

  @Post('merchants/:id/logo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube un logo de comercio personalizado' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
  uploadLogo(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: LogoUploadFile,
  ) {
    return this.merchants.uploadLogo(userId, id, file);
  }
}
