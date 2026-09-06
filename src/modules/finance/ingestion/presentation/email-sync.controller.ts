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
  Public,
  RequiresEnabledModule,
} from '../../../../core/decorators';
import { IngestionService } from '../application/ingestion.service';
import { ConnectEmailSourceDto } from './dto/connect-email-source.dto';
import {
  AssignEmailMessageDto,
  GoogleOAuthUrlQueryDto,
} from './dto/oauth-callback-query.dto';
import { UpdateEmailSourceDto } from './dto/update-email-source.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/email-sync')
export class EmailSyncController {
  private readonly logger = new Logger(EmailSyncController.name);

  constructor(private readonly ingestion: IngestionService) {}

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
  @ApiOperation({ summary: 'List email imports waiting for a ledger target' })
  listPending(@CurrentUser('sub') userId: string) {
    return this.ingestion.listPendingAssignment(userId);
  }

  @Post('pending/:id/assign')
  @ApiOperation({ summary: 'Assign a pending email import to an account or card' })
  assignPending(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: AssignEmailMessageDto,
  ) {
    return this.ingestion.assignPendingMessage(userId, id, dto);
  }

  @Post('pending/:id/retry')
  @ApiOperation({ summary: 'Retry automatic routing for a pending email import' })
  retryPending(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.ingestion.retryPendingMessage(userId, id);
  }

  @Get('oauth/google/url')
  @ApiOperation({ summary: 'Get Google OAuth URL for Gmail' })
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
      throw new BadRequestException('Missing code or state');
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
