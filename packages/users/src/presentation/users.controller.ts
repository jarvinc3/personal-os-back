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
import { MarkReleaseNotesSeenDto } from './dto/mark-release-notes-seen.dto';
import { UpdateModuleConfigDto } from './dto/update-module-config.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { WipeUserDataDto } from './dto/wipe-user-data.dto';
import {
  DataAppBranchesResponseDto,
  DeleteAccountResponseDto,
  UserProfileResponseDto,
  WipeUserDataResponseDto,
} from './dto/user-response.dto';
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
  @ApiOkResponse({
    description: 'Current user profile',
    type: UserProfileResponseDto,
  })
  getMyProfile(@CurrentUser('sub') userId: string) {
    return this.usersService.findById(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Actualiza el perfil del usuario autenticado' })
  @ApiOkResponse({
    description: 'Updated user profile',
    type: UserProfileResponseDto,
  })
  updateMyProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('me/release-notes-seen')
  @ApiOperation({
    summary: 'Marca la versión de Novedades que el usuario ya vio',
  })
  @ApiOkResponse({
    description: 'Updated user profile',
    type: UserProfileResponseDto,
  })
  async markReleaseNotesSeen(
    @CurrentUser('sub') userId: string,
    @Body() dto: MarkReleaseNotesSeenDto,
  ) {
    await this.usersService.markReleaseNotesSeen(userId, dto.version);
    return this.usersService.findById(userId);
  }

  @Patch('me/modules/:slug')
  @ApiOperation({
    summary: 'Actualiza la configuración de un módulo del usuario',
  })
  @ApiOkResponse({
    description: 'Updated user profile with module config',
    type: UserProfileResponseDto,
  })
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
  @ApiOkResponse({
    description: 'Account deleted successfully',
    type: DeleteAccountResponseDto,
  })
  deleteMyAccount(@CurrentUser('sub') userId: string) {
    return this.usersService.deleteAccount(userId);
  }

  @Get('me/data/branches')
  @ApiOperation({
    summary: 'Ramas de datos por app, con su conteo y lo que arrastran',
  })
  @ApiOkResponse({
    description: 'Branches grouped by app with their counts',
    type: [DataAppBranchesResponseDto],
  })
  myDataBranches(@CurrentUser('sub') userId: string) {
    return this.wipeUserData.listBranches(userId);
  }

  @Post('me/data/wipe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Borra las ramas de datos elegidas sin cerrar la cuenta',
  })
  @ApiOkResponse({
    description: 'Requested and applied branches with counts',
    type: WipeUserDataResponseDto,
  })
  wipeMyData(@CurrentUser('sub') userId: string, @Body() dto: WipeUserDataDto) {
    return this.wipeUserData.execute(userId, dto.branches, {
      expectedCounts: dto.expectedCounts,
      balanceInstitutionId: dto.balanceInstitutionId,
    });
  }
}
