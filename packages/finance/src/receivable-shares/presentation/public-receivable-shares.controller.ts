import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@personal-os/core';
import { PublicReceivableSharesService } from '../application/public-receivable-shares.service';

const PUBLIC_SHARE_REQUESTS_PER_MINUTE = 30;
const ONE_MINUTE_MS = 60_000;

@ApiTags('public')
@Controller('public/receivable-shares')
export class PublicReceivableSharesController {
  constructor(private readonly shares: PublicReceivableSharesService) {}

  @Public()
  @Throttle({
    long: { limit: PUBLIC_SHARE_REQUESTS_PER_MINUTE, ttl: ONE_MINUTE_MS },
  })
  @Header('X-Robots-Tag', 'noindex')
  @Get(':token')
  @ApiOperation({
    summary: 'Cobros compartidos por link público, en solo lectura',
  })
  get(@Param('token') token: string) {
    return this.shares.getByToken(token, new Date());
  }
}
