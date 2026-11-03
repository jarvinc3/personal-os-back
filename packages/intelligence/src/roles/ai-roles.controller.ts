import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiRolesService } from './ai-roles.service';
import { Roles } from './ai-role.decorator';
import { UpdateAiRoleDto } from './dto/update-ai-role.dto';
import {
  AiRoleAssignmentResponseDto,
  AiRoleUserResponseDto,
} from './ai-roles-response.dto';

@ApiTags('intelligence-roles')
@ApiBearerAuth('access-token')
@Controller('intelligence/admin/roles')
@Roles('ADMIN')
export class AiRolesController {
  constructor(private readonly roles: AiRolesService) {}

  @Get()
  @ApiOkResponse({ type: [AiRoleUserResponseDto] })
  list() {
    return this.roles.list();
  }

  @Patch(':userId')
  @ApiOkResponse({ type: AiRoleAssignmentResponseDto })
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateAiRoleDto,
    @CurrentUser() actor: { sub: string },
  ) {
    return this.roles.setRole(userId, dto.role, actor.sub);
  }
}
