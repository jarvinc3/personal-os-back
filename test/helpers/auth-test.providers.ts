import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { TestingModuleBuilder } from '@nestjs/testing';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { type Env, getSupabaseAuthConfig } from '../../src/config';
import {
  SupabaseJwtStrategy,
  SupabaseJwtVerifierService,
  type AuthUserContext,
  type SupabaseJwtPayload,
} from '../../src/modules/auth';

export const TEST_JWT_SECRET = 'test-secret';

/**
 * HS256 strategy used only in e2e via provider override.
 * Never imported by AppModule / main.
 */
@Injectable()
export class TestHs256SupabaseJwtStrategy extends PassportStrategy(
  Strategy,
  'supabase-jwt',
) {
  constructor(config: ConfigService<Env, true>) {
    const authConfig = getSupabaseAuthConfig(config);
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: authConfig.issuer,
      audience: authConfig.audience,
      algorithms: ['HS256'] as const,
      secretOrKey: TEST_JWT_SECRET,
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

/**
 * Verifies HS256 test JWTs (no short-circuit). Used only in e2e overrides.
 */
@Injectable()
export class TestHs256JwtVerifier {
  private readonly authConfig;

  constructor(config: ConfigService<Env, true>) {
    this.authConfig = getSupabaseAuthConfig(config);
  }

  verifyAccessToken(token: string): Promise<AuthUserContext> {
    try {
      const payload = jwt.verify(token, TEST_JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: this.authConfig.issuer,
        audience: this.authConfig.audience,
      }) as JwtPayload;

      if (!payload.sub) {
        return Promise.reject(
          new UnauthorizedException('Missing sub in JWT payload'),
        );
      }

      return Promise.resolve({
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        role: typeof payload.role === 'string' ? payload.role : null,
      });
    } catch (error: unknown) {
      return Promise.reject(
        new UnauthorizedException(
          error instanceof Error ? error.message : 'Invalid token',
        ),
      );
    }
  }
}

export function applyAuthTestOverrides(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder
    .overrideProvider(SupabaseJwtStrategy)
    .useClass(TestHs256SupabaseJwtStrategy)
    .overrideProvider(SupabaseJwtVerifierService)
    .useClass(TestHs256JwtVerifier);
}
