import { RequestMethod } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';

export function buildPinoLoggerParams(
  config: ConfigService<Env, true>,
): Params {
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  return {
    pinoHttp: {
      level: nodeEnv === 'production' ? 'info' : 'debug',
      transport:
        nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                levelFirst: true,
                singleLine: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                ignore: 'pid,hostname,req,res,userId',
                messageFormat:
                  '{msg}{if context} [{context}]{end}{if method} | {method} {path} | {statusCode} | {responseTime}ms | requestId={requestId}{end}',
              },
            }
          : undefined,
      // El interceptor registra la plantilla de ruta; el log automático de
      // pino-http vuelca la URL cruda y con ella los tokens del path.
      autoLogging: false,
      // Sin los objetos req/res en el logger hijo, ningún log arrastra la
      // URL cruda. El interceptor ya aporta método, ruta, estado y requestId.
      quietReqLogger: true,
      quietResLogger: true,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.body.password',
        'req.body.token',
        'req.body.code',
        'req.body.state',
        'req.body.accessToken',
        'req.body.access_token',
        'req.body.refreshToken',
        'req.body.refresh_token',
        'req.query.code',
        'req.query.state',
        'req.query.token',
        'req.query.access_token',
      ],
      genReqId: (req) => {
        const requestIdHeader = req.headers['x-request-id'];
        return (
          (typeof requestIdHeader === 'string' ? requestIdHeader : undefined) ??
          randomUUID()
        );
      },
      customProps: (req) => ({
        userId: (
          req as {
            user?: {
              sub?: string;
            };
          }
        ).user?.sub,
      }),
    },
    forRoutes: [{ path: '*path', method: RequestMethod.ALL }],
  };
}
