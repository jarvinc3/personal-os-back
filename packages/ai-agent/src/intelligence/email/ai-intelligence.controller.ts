import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Env } from '@personal-os/config';
import { CurrentUser, Public } from '@personal-os/core';
import type { Response } from 'express';
import { AiEmailSourceService } from './ai-email-source.service';
import { GmailSyncService } from './gmail-sync.service';

@ApiTags('intelligence')
@ApiBearerAuth('access-token')
@Controller('intelligence')
export class AiIntelligenceController {
  constructor(
    private readonly email: AiEmailSourceService,
    private readonly sync: GmailSyncService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  dashboard(@CurrentUser() user: { sub: string }) {
    return this.email.dashboard(user.sub);
  }

  @Get('messages')
  messages(
    @CurrentUser() user: { sub: string },
    @Query('cursor') cursor?: string,
  ) {
    return this.email.listMessages(user.sub, cursor);
  }

  @Get('messages/:messageId')
  message(
    @CurrentUser() user: { sub: string },
    @Param('messageId') messageId: string,
  ) {
    return this.email.getMessage(user.sub, messageId);
  }

  @Post('email/connect')
  connect(@CurrentUser() user: { sub: string }) {
    return {
      authorizationUrl: this.email.createAuthorizationUrl(user.sub),
    };
  }

  @Post('email/sync')
  syncNow(@CurrentUser() user: { sub: string }) {
    return this.sync.syncForUser(user.sub);
  }

  @Get('email/oauth/callback')
  @Public()
  callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    const webBaseUrl =
      this.config.get('PUBLIC_WEB_URL', { infer: true }) ??
      this.config.get('CORS_ORIGIN', { infer: true }).split(',')[0].trim();
    const redirect = (gmailStatus: 'connected' | 'error') =>
      response.redirect(
        new URL(`/intelligence?gmail=${gmailStatus}`, webBaseUrl).toString(),
      );
    if (error) {
      return redirect('error');
    }
    if (!code || !state) {
      throw new BadRequestException('Faltan code o state en el callback OAuth');
    }
    return this.email
      .completeAuthorization(code, state)
      .then((connection) => this.sync.syncConnection(connection.id))
      .then(() => redirect('connected'))
      .catch(() => redirect('error'));
  }

  @Get('email/oauth/diagnostics')
  diagnostics() {
    return this.email.oauthDiagnostics();
  }
}
