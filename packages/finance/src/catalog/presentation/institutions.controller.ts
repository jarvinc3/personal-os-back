import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
  list(@CurrentUser('sub') userId: string) {
    return this.catalog.listInstitutions(userId);
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
  @ApiOperation({ summary: 'Upload a custom institution logo' })
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
  @ApiOperation({ summary: 'Hard-delete institution and dependents' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deleteInstitution(userId, id);
  }

  @Post('institutions/:id/restore')
  @ApiOperation({ summary: 'Undo a delete from the journal snapshot' })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.restoreInstitution(userId, id, new Date());
  }
}
