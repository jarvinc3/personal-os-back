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
  @ApiOperation({ summary: 'List merchants with their month spend' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListMerchantsQueryDto,
  ) {
    return this.merchants.list(userId, query);
  }

  @Get('merchants/suggest')
  @ApiOperation({ summary: 'Best known merchant for a typed name' })
  suggest(
    @CurrentUser('sub') userId: string,
    @Query() query: SuggestMerchantQueryDto,
  ) {
    return this.merchants.suggest(userId, query.merchant);
  }

  @Get('merchants/:id')
  @ApiOperation({ summary: 'Merchant detail' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.merchants.get(userId, id);
  }

  @Patch('merchants/:id')
  @ApiOperation({ summary: 'Rename a merchant or set its category and logo' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMerchantDto,
  ) {
    return this.merchants.update(userId, id, dto);
  }

  @Post('merchants/:id/merge')
  @ApiOperation({ summary: 'Move the movements of a merchant into another' })
  merge(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: MergeMerchantDto,
  ) {
    return this.merchants.merge(userId, id, dto.targetId);
  }

  @Post('merchants/:id/logo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a custom merchant logo' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
  uploadLogo(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: LogoUploadFile,
  ) {
    return this.merchants.uploadLogo(userId, id, file);
  }
}
