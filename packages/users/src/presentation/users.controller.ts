import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { UpdateModuleConfigDto } from './dto/update-module-config.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from '../application/users.service';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get authenticated user profile' })
  @ApiOkResponse({ description: 'Current user profile' })
  getMyProfile(@CurrentUser('sub') userId: string) {
    return this.usersService.findById(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update authenticated user profile' })
  @ApiOkResponse({ description: 'Updated user profile' })
  updateMyProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('me/modules/:slug')
  @ApiOperation({ summary: 'Update module config for authenticated user' })
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
    summary: 'Delete authenticated user account and associated data',
  })
  @ApiOkResponse({ description: 'Account deleted successfully' })
  deleteMyAccount(@CurrentUser('sub') userId: string) {
    return this.usersService.deleteAccount(userId);
  }
}
