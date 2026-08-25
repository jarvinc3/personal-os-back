import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../core/decorators';
import { CatalogService } from '../application/catalog.service';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
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

  @Patch('institutions/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInstitutionDto,
  ) {
    return this.catalog.updateInstitution(userId, id, dto);
  }

  @Delete('institutions/:id')
  @ApiOperation({ summary: 'Deactivate institution' })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deactivateInstitution(userId, id);
  }
}
