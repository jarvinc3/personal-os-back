import {
  isAllowedCorsOrigin,
  parseCorsOriginPatterns,
} from '@personal-os/config';

export type CorsOriginCallback = (
  error: Error | null,
  allowed?: boolean,
) => void;

export type NotificationsCorsOrigin =
  | string
  | string[]
  | false
  | ((origin: string | undefined, callback: CorsOriginCallback) => void);

type NotificationsCorsInput = {
  corsOrigin: string | undefined;
  previewPatterns: string | undefined;
  isProduction: boolean;
};

/**
 * Socket.io CORS for `/notifications`. Production keeps the exact
 * `CORS_ORIGIN` list; development also accepts the branch preview patterns,
 * the same origins the REST API allows.
 */
export function resolveNotificationsCorsOrigin({
  corsOrigin,
  previewPatterns,
  isProduction,
}: NotificationsCorsInput): NotificationsCorsOrigin {
  const allowedOrigins = (corsOrigin ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (isProduction) {
    if (allowedOrigins.length === 0) {
      return false;
    }

    return allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins;
  }

  const originPatterns = parseCorsOriginPatterns(previewPatterns);

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    callback(
      null,
      isAllowedCorsOrigin({
        origin,
        allowedOrigins,
        originPatterns,
      }),
    );
  };
}
