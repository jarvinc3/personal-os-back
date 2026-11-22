import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { type Env, getSupabaseAuthConfig } from '@personal-os/config';
import { SUPPORTED_JWT_ALGORITHMS } from '../../domain/jwt-algorithms';
import { createJwksSecretProvider } from '../jwks-secret-provider';
import type {
  AuthUserContext,
  SupabaseJwtPayload,
} from '../../domain/supabase-jwt-payload';

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(
  Strategy,
  'supabase-jwt',
) {
  constructor(config: ConfigService<Env, true>) {
    const authConfig = getSupabaseAuthConfig(config);
    let jwksProvider: ReturnType<typeof createJwksSecretProvider> | null = null;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: authConfig.issuer,
      audience: authConfig.audience,
      algorithms: [...SUPPORTED_JWT_ALGORITHMS],
      // Lazy JWKS load so constructing the strategy does not require `jose`/jwks-rsa
      // (keeps Jest e2e bootable when the strategy is not overridden).
      secretOrKeyProvider: (request, rawJwtToken, done) => {
        jwksProvider ??= createJwksSecretProvider(authConfig);
        if (typeof rawJwtToken !== 'string') {
          done(new Error('Invalid JWT token'));
          return;
        }
        return jwksProvider(request, rawJwtToken, done);
      },
    });
  }

  validate(payload: SupabaseJwtPayload): AuthUserContext {
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      role: payload.role ?? null,
    };
  }
}
