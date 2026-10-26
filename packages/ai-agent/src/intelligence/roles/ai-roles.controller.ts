import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiRolesService } from './ai-roles.service';
import { Roles } from './ai-role.decorator';
import { UpdateAiRoleDto } from './dto/update-ai-role.dto';

@ApiTags('intelligence-roles')
@ApiBearerAuth('access-token')
@Controller('ai/admin/roles')
@Roles('ADMIN')
export class AiRolesController {
  constructor(private readonly roles: AiRolesService) {}

  @Get()
  list() {
    return this.roles.list();
  }

  @Patch(':userId')
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateAiRoleDto,
    @CurrentUser() actor: { sub: string },
  ) {
    return this.roles.setRole(userId, dto.role, actor.sub);
  }
}
