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
import { DismissSubscriptionAlertDto } from './dto/dismiss-subscription-alert.dto';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto';
import { SubscriptionBreakdownQueryDto } from './dto/subscription-breakdown-query.dto';
import { UpcomingSubscriptionsQueryDto } from './dto/upcoming-subscriptions-query.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista las suscripciones gestionadas' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListSubscriptionsQueryDto,
  ) {
    return this.subscriptions.list(userId, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Costo mensual y anual, cantidad activa y próximos',
  })
  summary(@CurrentUser('sub') userId: string) {
    return this.subscriptions.summary(userId);
  }

  @Get('breakdown')
  @ApiOperation({ summary: 'Costo por categoría, instrumento o moneda' })
  breakdown(
    @CurrentUser('sub') userId: string,
    @Query() query: SubscriptionBreakdownQueryDto,
  ) {
    return this.subscriptions.breakdown(userId, query.by ?? 'category');
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Cargos previstos en una ventana de fechas' })
  upcoming(
    @CurrentUser('sub') userId: string,
    @Query() query: UpcomingSubscriptionsQueryDto,
  ) {
    return this.subscriptions.upcoming(userId, query);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Alertas activas de suscripciones' })
  alerts(@CurrentUser('sub') userId: string) {
    return this.subscriptions.alerts(userId);
  }

  @Post('alerts/dismiss-all')
  @ApiOperation({ summary: 'Descarta todas las alertas activas' })
  dismissAllAlerts(@CurrentUser('sub') userId: string) {
    return this.subscriptions.dismissAllAlerts(userId);
  }

  @Post('alerts/dismiss')
  @ApiOperation({ summary: 'Descarta una alerta para su ocurrencia' })
  dismissAlert(
    @CurrentUser('sub') userId: string,
    @Body() dto: DismissSubscriptionAlertDto,
  ) {
    return this.subscriptions.dismissAlert(userId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una suscripción' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de la suscripción' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.get(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita una suscripción' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptions.update(userId, id, dto);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pausa una suscripción' })
  pause(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.pause(userId, id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Reanuda una suscripción pausada' })
  resume(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.resume(userId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancela una suscripción' })
  cancel(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subscriptions.cancel(userId, id);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'Historial de pagos' })
  listPayments(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query() query: CursorQueryDto,
  ) {
    return this.subscriptions.listPayments(userId, id, query);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Registra un pago manual' })
  createPayment(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateSubscriptionPaymentDto,
  ) {
    return this.subscriptions.recordManualPayment(userId, id, dto);
  }

  @Post(':id/logo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube un logo de suscripción personalizado' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
  uploadLogo(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: LogoUploadFile,
  ) {
    return this.subscriptions.uploadLogo(userId, id, file);
  }
}
