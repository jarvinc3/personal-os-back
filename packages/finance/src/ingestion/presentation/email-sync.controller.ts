import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  CurrentUser,
  CursorQueryDto,
  Public,
  RequiresEnabledModule,
  Timeout,
} from '@personal-os/core';
import { IngestionService } from '../application/ingestion.service';
import { ConnectEmailSourceDto } from './dto/connect-email-source.dto';
import {
  AssignEmailMessageDto,
  CompletePendingAmountDto,
  GoogleOAuthUrlQueryDto,
} from './dto/oauth-callback-query.dto';
import {
  AddEmailSourceSendersDto,
  UpdateEmailSourceDto,
} from './dto/update-email-source.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/email-sync')
export class EmailSyncController {
  private readonly logger = new Logger(EmailSyncController.name);

  constructor(private readonly ingestion: IngestionService) {}

  @Get('mailboxes')
  @ApiOperation({
    summary: 'Lista los buzones de Gmail autorizados con sus bancos',
  })
  listMailboxes(@CurrentUser('sub') userId: string) {
    return this.ingestion.listMailboxes(userId);
  }

  @Delete('mailboxes/:id')
  @ApiOperation({
    summary: 'Desconecta un buzón de Gmail y sus bancos vinculados',
  })
  removeMailbox(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.ingestion.deactivateMailbox(userId, id);
  }

  @Get('sources')
  list(@CurrentUser('sub') userId: string) {
    return this.ingestion.listEmailSources(userId);
  }

  @Post('sources')
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: ConnectEmailSourceDto,
  ) {
    return this.ingestion.createEmailSource(userId, dto);
  }

  @Patch('sources/:id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmailSourceDto,
  ) {
    return this.ingestion.updateEmailSource(userId, id, dto);
  }

  @Delete('sources/:id')
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.ingestion.deactivateEmailSource(userId, id);
  }

  @Post('sources/:id/sync')
  @Timeout(8_000)
  sync(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query('forceFullSync') forceFullSync?: string,
  ) {
    return this.ingestion.triggerEmailSync(
      userId,
      id,
      forceFullSync === 'true',
    );
  }

  @Get('pending')
  @ApiOperation({
    summary: 'Lista las importaciones de correo que esperan un destino',
  })
  listPending(
    @CurrentUser('sub') userId: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.ingestion.listPendingAssignment(userId, query);
  }

  @Get('messages')
  @ApiOperation({
    summary: 'Lista los resultados recientes de extracción de correo',
  })
  listRecentMessages(
    @CurrentUser('sub') userId: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.ingestion.listRecentMessages(userId, query);
  }

  @Post('pending/:id/assign')
  @ApiOperation({
    summary:
      'Asigna una importación de correo pendiente a una cuenta o tarjeta',
  })
  assignPending(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: AssignEmailMessageDto,
  ) {
    return this.ingestion.assignPendingMessage(userId, id, dto);
  }

  @Post('pending/:id/retry')
  @ApiOperation({
    summary:
      'Reintenta el enrutado automático de una importación de correo pendiente',
  })
  retryPending(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.ingestion.retryPendingMessage(userId, id);
  }

  @Post('pending/:id/amount')
  @ApiOperation({
    summary: 'Completa una importación de nómina o depósito sin monto',
  })
  completeAmount(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CompletePendingAmountDto,
  ) {
    return this.ingestion.completePendingAmount(userId, id, dto.amount);
  }

  @Get('sources/:id/discovered-senders')
  @ApiOperation({
    summary:
      'List other From addresses on this bank domain without calling the model',
  })
  listDiscoveredSenders(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.ingestion.listDiscoveredSenders(userId, id);
  }

  @Post('sources/:id/senders')
  @ApiOperation({
    summary: 'Agrega remitentes permitidos para esta institución',
  })
  addSenders(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: AddEmailSourceSendersDto,
  ) {
    return this.ingestion.addSourceSenders(userId, id, dto.emails);
  }

  @Get('oauth/google/url')
  @ApiOperation({ summary: 'Obtiene la URL de OAuth de Google para Gmail' })
  getOAuthUrl(
    @CurrentUser('sub') userId: string,
    @Query() query: GoogleOAuthUrlQueryDto,
  ) {
    return this.ingestion.getGoogleOAuthUrl(userId, query);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('oauth/google/callback')
  async handleGoogleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.warn(`OAuth error: ${error}`);
      return res.redirect(
        this.ingestion.resolveOAuthClientRedirect(state, false),
      );
    }
    if (!code || !state) {
      if (state) {
        return res.redirect(
          this.ingestion.resolveOAuthClientRedirect(state, false),
        );
      }
      throw new BadRequestException('Falta el code o el state');
    }
    try {
      await this.ingestion.handleGoogleOAuthCallback(code, state);
      return res.redirect(
        this.ingestion.resolveOAuthClientRedirect(state, true),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'oauth_failed';
      this.logger.warn(`OAuth callback failed: ${message}`);
      return res.redirect(
        this.ingestion.resolveOAuthClientRedirect(state, false),
      );
    }
  }
}
