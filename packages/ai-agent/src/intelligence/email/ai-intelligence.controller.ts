import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Env } from '@personal-os/config';
import { CurrentUser, Public, Timeout } from '@personal-os/core';
import type { Response } from 'express';
import { AiEmailSourceService } from './ai-email-source.service';
import { GmailSyncService } from './gmail-sync.service';
import { ResetEmailCorpusDto } from './dto/reset-email-corpus.dto';
import {
  AiEmailConnectResponseDto,
  AiEmailDashboardResponseDto,
  AiEmailDiagnosticsResponseDto,
  AiEmailMessagePageResponseDto,
  AiEmailMessageResponseDto,
  AiEmailResetResponseDto,
  AiEmailSyncResponseDto,
} from './ai-intelligence-response.dto';

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
  @ApiOkResponse({ type: AiEmailDashboardResponseDto })
  dashboard(@CurrentUser() user: { sub: string }) {
    return Promise.all([
      this.email.dashboard(user.sub),
      this.sync.getSyncSnapshotForUser(user.sub),
    ]).then(([dashboard, syncSnapshot]) => {
      if (!dashboard.connection.connected) {
        return dashboard;
      }
      return {
        ...dashboard,
        connection: { ...dashboard.connection, ...syncSnapshot },
      };
    });
  }

  @Get('messages')
  @ApiOkResponse({ type: AiEmailMessagePageResponseDto })
  messages(
    @CurrentUser() user: { sub: string },
    @Query('cursor') cursor?: string,
  ) {
    return this.email.listMessages(user.sub, cursor);
  }

  @Get('messages/:messageId')
  @ApiOkResponse({ type: AiEmailMessageResponseDto })
  message(
    @CurrentUser() user: { sub: string },
    @Param('messageId') messageId: string,
  ) {
    return this.email.getMessage(user.sub, messageId);
  }

  @Post('email/connect')
  @ApiCreatedResponse({ type: AiEmailConnectResponseDto })
  connect(@CurrentUser() user: { sub: string }) {
    return {
      authorizationUrl: this.email.createAuthorizationUrl(user.sub),
    };
  }

  @Post('email/sync')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AiEmailSyncResponseDto })
  syncNow(@CurrentUser() user: { sub: string }) {
    return this.sync.syncForUser(user.sub);
  }

  @Post('email/reset')
  @ApiCreatedResponse({ type: AiEmailResetResponseDto })
  @ApiConflictResponse({
    description:
      'GMAIL_NOT_CONNECTED si no hay conexión; GMAIL_SYNC_IN_PROGRESS si hay una sincronización activa o esperando cuota.',
    schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: ['GMAIL_NOT_CONNECTED', 'GMAIL_SYNC_IN_PROGRESS'],
        },
        message: { type: 'string' },
      },
    },
  })
  resetEmailCorpus(
    @CurrentUser() user: { sub: string },
    @Body() dto: ResetEmailCorpusDto,
  ) {
    if (dto.confirmed !== true) {
      throw new BadRequestException('Confirma el reinicio del correo');
    }
    return this.sync.resetEmailCorpus(user.sub);
  }

  @Get('email/oauth/callback')
  @Public()
  @Timeout(20_000)
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
      .then((connection) => {
        // The initial Gmail bootstrap can import hundreds of messages and
        // exceed the global request timeout. Persist OAuth first, redirect,
        // and let the sync run independently of the browser request.
        void this.sync.syncConnection(connection.id).catch(() => undefined);
        return redirect('connected');
      })
      .catch(() => redirect('error'));
  }

  @Get('email/oauth/diagnostics')
  @ApiOkResponse({ type: AiEmailDiagnosticsResponseDto })
  diagnostics() {
    return this.email.oauthDiagnostics();
  }
}
