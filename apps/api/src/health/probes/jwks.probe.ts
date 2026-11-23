import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HttpHealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { type Env, getSupabaseAuthConfig } from '@personal-os/config';

/** Una sonda de JWKS colgada no debe retener la petición ni la conexión. */
const JWKS_PING_TIMEOUT_MS = 2_000;

/** Una sonda pública anónima no debe amplificar tráfico hacia el proveedor. */
const JWKS_RESULT_TTL_MS = 60_000;

@Injectable()
export class JwksProbe {
  private jwksResult: HealthIndicatorResult | null = null;
  private jwksCheckedAt = 0;

  constructor(
    private readonly http: HttpHealthIndicator,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  /**
   * JWKS solo entra en el startup: el readiness no depende de un tercero. El
   * resultado correcto se reutiliza un minuto y un fallo no se guarda, así que
   * la siguiente sonda reintenta en cuanto el proveedor vuelva.
   */
  async ping(): Promise<HealthIndicatorResult> {
    const cached = this.jwksResult;
    if (cached && Date.now() - this.jwksCheckedAt < JWKS_RESULT_TTL_MS) {
      return cached;
    }
    const jwksUri = getSupabaseAuthConfig(this.configService).jwksUri;
    const jwksCheck = await this.http.pingCheck('jwks', jwksUri, {
      timeout: JWKS_PING_TIMEOUT_MS,
    });
    this.jwksResult = jwksCheck;
    this.jwksCheckedAt = Date.now();
    return jwksCheck;
  }
}
