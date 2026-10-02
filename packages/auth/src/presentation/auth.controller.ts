import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CurrentUser } from '@personal-os/core';
import { UserLoggedInEvent } from '@personal-os/core';
import { AppEvents } from '@personal-os/core';
import type { AuthUserContext } from '../domain/supabase-jwt-payload';

const USER_LOGGED_IN_TTL_MS = 3600_000;

type CacheStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<unknown>;
};

@ApiTags('auth')
@ApiBearerAuth('access-token')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cache: CacheStore,
  ) {}

  @Get('session')
  @ApiOperation({ summary: 'Get authenticated session context' })
  @ApiOkResponse({ description: 'Current authenticated user context' })
  async session(@CurrentUser() user: AuthUserContext) {
    const cacheKey = `user.logged_in:${user.sub}`;
    const cached = await this.cache.get(cacheKey);

    if (!cached) {
      await this.cache.set(cacheKey, '1', USER_LOGGED_IN_TTL_MS);
      this.eventEmitter.emit(
        AppEvents.USER_LOGGED_IN,
        new UserLoggedInEvent(user.sub, user.email ?? null),
      );
    }

    return user;
  }
}
