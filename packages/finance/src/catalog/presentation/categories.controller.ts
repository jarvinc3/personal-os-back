import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CatalogService } from '../application/catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListCategoriesQueryDto,
  ) {
    if (query.type === 'TRANSFER') {
      throw new BadRequestException('Category type must be EXPENSE or INCOME');
    }
    return this.catalog.listCategories(userId, query.type);
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
