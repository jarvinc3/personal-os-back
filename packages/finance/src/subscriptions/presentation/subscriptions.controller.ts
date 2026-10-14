import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CursorQueryDto,
  RequiresEnabledModule,
} from '@personal-os/core';
import type { LogoUploadFile } from '@personal-os/logos';
import { SubscriptionsService } from '../application/subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CreateSubscriptionPaymentDto } from './dto/create-subscription-payment.dto';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'List managed subscriptions' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListSubscriptionsQueryDto,
  ) {
    return this.subscriptions.list(userId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Monthly and annual cost, active count, upcoming' })
  summary(@CurrentUser('sub') userId: string) {
    return this.subscriptions.summary(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a subscription' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Subscription detail' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.get(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a subscription' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptions.update(userId, id, dto);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a subscription' })
  pause(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.pause(userId, id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused subscription' })
  resume(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.resume(userId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription' })
  cancel(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.cancel(userId, id);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'Payment history' })
  listPayments(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.subscriptions.listPayments(userId, id, query);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Register a manual payment' })
  createPayment(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateSubscriptionPaymentDto,
  ) {
    return this.subscriptions.recordManualPayment(userId, id, dto);
  }

  @Post(':id/logo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a custom subscription logo' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
  uploadLogo(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: LogoUploadFile,
  ) {
    return this.subscriptions.uploadLogo(userId, id, file);
  }
}
