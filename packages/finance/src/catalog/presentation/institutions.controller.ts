import {
  Body,
  Controller,
  Delete,
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
import {
  CurrentUser,
  CursorQueryDto,
  RequiresEnabledModule,
} from '@personal-os/core';
import type { LogoUploadFile } from '@personal-os/logos';
import { CatalogService } from '../application/catalog.service';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class InstitutionsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('institutions')
  @ApiOperation({ summary: 'Lista las instituciones de finanzas (cursor)' })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.catalog.listInstitutionsPage(userId, query);
  }

  @Post('institutions')
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateInstitutionDto,
  ) {
    return this.catalog.createInstitution(userId, dto);
  }

  @Post('institutions/:id/logo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube un logo de institución personalizado' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
  uploadLogo(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: LogoUploadFile,
  ) {
    return this.catalog.uploadInstitutionLogo(userId, id, file);
  }

  @Patch('institutions/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInstitutionDto,
  ) {
    return this.catalog.updateInstitution(userId, id, dto);
  }

  @Delete('institutions/:id')
  @ApiOperation({
    summary: 'Borra de forma definitiva la institución y sus dependientes',
  })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deleteInstitution(userId, id);
  }

  @Post('institutions/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.restoreInstitution(userId, id, new Date());
  }
}
