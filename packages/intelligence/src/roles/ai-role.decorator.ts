import { SetMetadata } from '@nestjs/common';

export const AI_ROLES_KEY = 'ai:roles';
export type AiRole = 'USER' | 'CONTRIBUTOR' | 'ADMIN';

export const AI_ROLES = ['USER', 'CONTRIBUTOR', 'ADMIN'] as const;

export const Roles = (...roles: AiRole[]) => SetMetadata(AI_ROLES_KEY, roles);
