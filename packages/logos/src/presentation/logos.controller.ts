import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresEnabledModule } from '@personal-os/core';
import { LogoService } from '../application/logo.service';

@ApiTags('brands')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('brands')
export class LogosController {
  constructor(private readonly logos: LogoService) {}

  @Get('search')
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  search(@Query('q') q = '') {
    return this.logos.search(q);
  }
}
