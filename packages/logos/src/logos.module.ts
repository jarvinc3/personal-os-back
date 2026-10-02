import { Module } from '@nestjs/common';
import { BRAND_LOGO } from './application/ports/brand-logo.port';
import { LOGO_STORAGE } from './application/ports/logo-storage.port';
import { LogoService } from './application/logo.service';
import { LogoDevBrandClient } from './infrastructure/logo-dev.brand.client';
import { SupabaseLogoStorage } from './infrastructure/supabase-logo.storage';
import { LogosController } from './presentation/logos.controller';

@Module({
  controllers: [LogosController],
  providers: [
    LogoService,
    SupabaseLogoStorage,
    LogoDevBrandClient,
    {
      provide: LOGO_STORAGE,
      useExisting: SupabaseLogoStorage,
    },
    {
      provide: BRAND_LOGO,
      useExisting: LogoDevBrandClient,
    },
  ],
  exports: [LogoService],
})
export class LogosModule {}
