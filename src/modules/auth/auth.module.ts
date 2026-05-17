import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';
import { SupabaseJwtVerifierService } from './supabase-jwt-verifier.service';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'supabase-jwt' })],
  controllers: [AuthController],
  providers: [SupabaseJwtStrategy, SupabaseJwtVerifierService],
  exports: [PassportModule, SupabaseJwtStrategy, SupabaseJwtVerifierService],
})
export class AuthModule {}
