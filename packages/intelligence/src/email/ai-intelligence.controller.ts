import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
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
import { EmailSampleImportService } from './email-sample-import.service';
import { GmailSyncService } from './gmail-sync.service';
import { ResetEmailCorpusDto } from './dto/reset-email-corpus.dto';
import { EmailSampleImportDto } from './dto/email-sample-import.dto';
import {
  AiEmailConnectResponseDto,
  AiEmailDashboardResponseDto,
  AiEmailDiagnosticsResponseDto,
  AiEmailMessagePageResponseDto,
  AiEmailMessageResponseDto,
  AiEmailResetResponseDto,
  AiEmailSampleImportResponseDto,
  AiEmailSyncResponseDto,
} from './ai-intelligence-response.dto';

@ApiTags('intelligence')
@ApiBearerAuth('access-token')
@Controller('intelligence')
export class AiIntelligenceController {
  private readonly logger = new Logger(AiIntelligenceController.name);

  constructor(
    private readonly email: AiEmailSourceService,
    private readonly sync: GmailSyncService,
    private readonly sampleImport: EmailSampleImportService,
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

  @Post('email/sample-import')
  @ApiOkResponse({ type: AiEmailSampleImportResponseDto })
  sampleImportRun(
    @CurrentUser() user: { sub: string },
    @Body() dto: EmailSampleImportDto,
  ) {
    this.assertSampleImportAllowed();
    return this.sampleImport.run({
      userId: user.sub,
      dryRun: dto.dryRun,
      selection: {
        messageIds: dto.selection.messageIds,
        sender: dto.selection.sender,
        dateFrom: dto.selection.dateFrom
          ? new Date(dto.selection.dateFrom)
          : undefined,
        dateTo: dto.selection.dateTo
          ? new Date(dto.selection.dateTo)
          : undefined,
      },
    });
  }

  /** Operación de piloto: fuera de producción la ruta no existe. */
  private assertSampleImportAllowed(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new NotFoundException();
    }
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
        void this.sync.syncConnection(connection.id).catch((error: unknown) => {
          this.logger.warn(
            `Gmail sync after OAuth failed for connection ${connection.id}: ${oauthErrorCode(error)}`,
          );
        });
        return redirect('connected');
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Gmail OAuth callback failed: ${oauthErrorCode(error)}`,
        );
        return redirect('error');
      });
  }

  @Get('email/oauth/diagnostics')
  @ApiOkResponse({ type: AiEmailDiagnosticsResponseDto })
  diagnostics() {
    return this.email.oauthDiagnostics();
  }
}

/** Código saneado para el registro: nunca el mensaje, el código OAuth ni el token. */
function oauthErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const { code, providerCode } = response as Record<string, unknown>;
      if (typeof providerCode === 'string') {
        return providerCode;
      }
      if (typeof code === 'string') {
        return code;
      }
    }
  }
  return error instanceof Error ? error.name : 'unknown_error';
}
