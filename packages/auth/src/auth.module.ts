import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SupabaseAdminService } from './infrastructure/supabase-admin.service';
import { SupabaseJwtVerifierService } from './infrastructure/supabase-jwt-verifier.service';
import { SupabaseJwtStrategy } from './infrastructure/strategies/supabase-jwt.strategy';
import { AuthController } from './presentation/auth.controller';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'supabase-jwt' })],
  controllers: [AuthController],
  providers: [
    SupabaseJwtStrategy,
    SupabaseJwtVerifierService,
    SupabaseAdminService,
  ],
  exports: [
    PassportModule,
    SupabaseJwtStrategy,
    SupabaseJwtVerifierService,
    SupabaseAdminService,
  ],
})
export class AuthModule {}
