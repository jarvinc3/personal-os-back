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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { CatalogService } from '../application/catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponseDto } from '../../shared/presentation/dto/category-response.dto';
import { SuccessResponseDto } from '../../shared/presentation/success-response.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @ApiOkResponse({ type: [CategoryResponseDto] })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListCategoriesQueryDto,
  ) {
    if (query.type === 'TRANSFER') {
      throw new BadRequestException(
        'El tipo de categoría debe ser EXPENSE o INCOME',
      );
    }
    return this.catalog.listCategories(userId, query.type);
  }

  @Post('categories')
  @ApiCreatedResponse({ type: CategoryResponseDto })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(userId, dto);
  }

  @Patch('categories/:id')
  @ApiOkResponse({ type: CategoryResponseDto })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(userId, id, dto);
  }

  @Delete('categories/:id')
  @ApiOkResponse({ type: SuccessResponseDto })
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.deleteCategory(userId, id);
  }

  @Post('categories/:id/restore')
  @ApiOperation({ summary: 'Deshace un borrado desde el journal' })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  restore(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.catalog.restoreCategory(userId, id, new Date());
  }
}
