import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CurrentUser } from '../../core/decorators';
import { AppEvents } from '../../core/events/event.constants';
import type { AuthUserContext } from './types/supabase-jwt-payload';

@ApiTags('auth')
@ApiBearerAuth('access-token')
@Controller('auth')
export class AuthController {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  @Get('session')
  @ApiOperation({ summary: 'Get authenticated session context' })
  @ApiOkResponse({ description: 'Current authenticated user context' })
  session(@CurrentUser() user: AuthUserContext) {
    this.eventEmitter.emit(AppEvents.USER_LOGGED_IN, {
      userId: user.sub,
      email: user.email,
    });
    return user;
  }
}
