import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../core/decorators';
import { CatalogService } from '../application/catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  list(@CurrentUser('sub') userId: string) {
    return this.catalog.listCategories(userId);
  }

  @Post('categories')
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(userId, dto);
  }

  @Patch('categories/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(userId, id, dto);
  }

  @Delete('categories/:id')
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deleteCategory(userId, id);
  }
}
