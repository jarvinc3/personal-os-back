import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

function unauthorized(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
  res.status(401).send('Unauthorized');
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Optional HTTP basic auth for Bull Board.
 * When user/password are omitted, the middleware is a no-op.
 */
export function createBullBoardAuthMiddleware(
  user?: string,
  password?: string,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!user || !password) {
    return (_req, _res, next) => {
      next();
    };
  }

  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Basic ')) {
      unauthorized(res);
      return;
    }

    let decoded: string;
    try {
      decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString(
        'utf8',
      );
    } catch {
      unauthorized(res);
      return;
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      unauthorized(res);
      return;
    }

    const providedUser = decoded.slice(0, separatorIndex);
    const providedPassword = decoded.slice(separatorIndex + 1);

    if (
      safeEqual(providedUser, user) &&
      safeEqual(providedPassword, password)
    ) {
      next();
      return;
    }

    unauthorized(res);
  };
}
