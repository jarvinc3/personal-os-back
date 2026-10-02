import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';
import { type Env, getSupabaseAuthConfig } from '@personal-os/config';
import type { AuthUserContext } from '../domain/supabase-jwt-payload';
import { createJwksClient, type JwksClientInstance } from './jwks-rsa.loader';

@Injectable()
export class SupabaseJwtVerifierService {
  private readonly authConfig;
  private client: JwksClientInstance | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.authConfig = getSupabaseAuthConfig(config);
  }

  async verifyAccessToken(token: string): Promise<AuthUserContext> {
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

    this.client ??= createJwksClient({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      jwksUri: this.authConfig.jwksUri,
    });

    const key = await this.client.getSigningKey(kid);
    return key.getPublicKey();
  }
}
