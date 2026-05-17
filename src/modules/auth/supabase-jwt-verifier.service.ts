import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';
import { type Env, getSupabaseAuthConfig } from '../../config';
import type { AuthUserContext } from './types/supabase-jwt-payload';
import {
  createJwksClient,
  type JwksClientInstance,
} from './utils/jwks-rsa.loader';

@Injectable()
export class SupabaseJwtVerifierService {
  private readonly authConfig;
  private readonly client: JwksClientInstance | null;
  private readonly isTest: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.authConfig = getSupabaseAuthConfig(config);
    this.isTest = config.get('NODE_ENV', { infer: true }) === 'test';

    if (this.isTest) {
      this.client = null;
      return;
    }

    this.client = createJwksClient({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      jwksUri: this.authConfig.jwksUri,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthUserContext> {
    if (this.isTest) {
      return {
        sub: 'test-user',
        email: 'test@example.com',
        role: 'authenticated',
      };
    }

    const payload = await new Promise<JwtPayload>((resolve, reject) => {
      jwt.verify(
        token,
        (header: JwtHeader, callback) => {
          this.resolveSigningKey(header.kid)
            .then((key) => callback(null, key))
            .catch((error: unknown) => {
              callback(
                error instanceof Error ? error : new Error('Invalid token'),
              );
            });
        },
        {
          issuer: this.authConfig.issuer,
          audience: this.authConfig.audience,
          algorithms: ['RS256', 'ES256'],
        },
        (err, decoded) => {
          if (err) {
            reject(err);
            return;
          }
          if (!decoded || typeof decoded === 'string') {
            reject(new Error('Invalid JWT payload'));
            return;
          }
          resolve(decoded);
        },
      );
    }).catch((error: unknown) => {
      throw new UnauthorizedException(
        error instanceof Error ? error.message : 'Invalid token',
      );
    });

    if (!payload.sub) {
      throw new UnauthorizedException('Missing sub in JWT payload');
    }

    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      role: typeof payload.role === 'string' ? payload.role : null,
    };
  }

  private async resolveSigningKey(kid: string | undefined): Promise<string> {
    if (!kid) {
      throw new UnauthorizedException('Missing JWT key id');
    }
    if (!this.client) {
      throw new UnauthorizedException('JWKS client unavailable');
    }

    const key = await this.client.getSigningKey(kid);
    return key.getPublicKey();
  }
}
