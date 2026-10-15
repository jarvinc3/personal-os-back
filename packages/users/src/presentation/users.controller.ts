import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { UpdateModuleConfigDto } from './dto/update-module-config.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { WipeUserDataDto } from './dto/wipe-user-data.dto';
import { UsersService } from '../application/users.service';
import { WipeUserDataUseCase } from '../application/wipe-user-data.use-case';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly wipeUserData: WipeUserDataUseCase,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Obtiene el perfil del usuario autenticado' })
  @ApiOkResponse({ description: 'Current user profile' })
  getMyProfile(@CurrentUser('sub') userId: string) {
    return this.usersService.findById(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Actualiza el perfil del usuario autenticado' })
  @ApiOkResponse({ description: 'Updated user profile' })
  updateMyProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('me/modules/:slug')
  @ApiOperation({
    summary: 'Actualiza la configuración de un módulo del usuario',
  })
  @ApiOkResponse({ description: 'Updated user profile with module config' })
  updateMyModuleConfig(
    @CurrentUser('sub') userId: string,
    @Param('slug') slug: string,
    @Body() dto: UpdateModuleConfigDto,
  ) {
    return this.usersService.updateModuleConfig(userId, slug, dto);
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Borra la cuenta del usuario y sus datos asociados',
  })
  @ApiOkResponse({ description: 'Account deleted successfully' })
  deleteMyAccount(@CurrentUser('sub') userId: string) {
    return this.usersService.deleteAccount(userId);
  }

  @Post('me/data/wipe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Borra capas de datos seleccionadas sin cerrar la cuenta',
  })
  @ApiOkResponse({ description: 'Requested and applied layers with counts' })
  wipeMyData(@CurrentUser('sub') userId: string, @Body() dto: WipeUserDataDto) {
    return this.wipeUserData.execute(userId, dto.layers, {
      balanceInstitutionId: dto.balanceInstitutionId,
    });
  }
}
