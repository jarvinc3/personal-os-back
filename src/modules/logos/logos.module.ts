import { Module } from '@nestjs/common';
import { LogoService } from './application/logo.service';
import { LogosController } from './presentation/logos.controller';

@Module({
  controllers: [LogosController],
  providers: [LogoService],
  exports: [LogoService],
})
export class LogosModule {}
