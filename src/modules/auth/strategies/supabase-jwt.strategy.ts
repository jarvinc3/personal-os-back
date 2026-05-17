import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { type Env, getSupabaseAuthConfig } from '../../../config';
import { createJwksSecretProvider } from '../utils/jwks-secret-provider';
import type {
  AuthUserContext,
  SupabaseJwtPayload,
} from '../types/supabase-jwt-payload';

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(
  Strategy,
  'supabase-jwt',
) {
  constructor(config: ConfigService<Env, true>) {
    const authConfig = getSupabaseAuthConfig(config);
    const nodeEnv = config.get('NODE_ENV', { infer: true });
    const isTest = nodeEnv === 'test';

    const baseOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: authConfig.issuer,
      audience: authConfig.audience,
    };

    if (isTest) {
      super({
        ...baseOptions,
        algorithms: ['HS256'] as const,
        secretOrKey: 'test-secret',
      });
      return;
    }

    super({
      ...baseOptions,
      algorithms: ['RS256', 'ES256'] as const,
      secretOrKeyProvider: createJwksSecretProvider(authConfig),
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
