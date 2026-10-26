import { IsIn } from 'class-validator';
import { AI_ROLES } from '../ai-role.decorator';

export class UpdateAiRoleDto {
  @IsIn(AI_ROLES)
  role!: (typeof AI_ROLES)[number];
}
