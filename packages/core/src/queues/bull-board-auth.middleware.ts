import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const BASIC_PREFIX = 'Basic ';

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
    if (!header?.startsWith(BASIC_PREFIX)) {
      unauthorized(res);
      return;
    }

    // Node's base64 decoder never throws on a malformed payload; the separator
    // check below rejects whatever it produces.
    const decoded = Buffer.from(
      header.slice(BASIC_PREFIX.length),
      'base64',
    ).toString('utf8');

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
