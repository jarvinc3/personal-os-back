import type { NextFunction, Request, Response } from 'express';
import { createBullBoardAuthMiddleware } from './bull-board-auth.middleware';

function mockRes(): Response & {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: string) {
      this.body = body;
      return this;
    },
  };
  return res as Response & {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  };
}

describe('createBullBoardAuthMiddleware', () => {
  it('is a no-op when credentials are omitted', () => {
    const middleware = createBullBoardAuthMiddleware();
    const next = jest.fn() as NextFunction;
    const res = mockRes();

    middleware({ headers: {} } as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 when Authorization header is missing', () => {
    const middleware = createBullBoardAuthMiddleware('admin', 'secret');
    const next = jest.fn() as NextFunction;
    const res = mockRes();

    middleware({ headers: {} } as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Bull Board"');
  });

  it('returns 401 when credentials are wrong', () => {
    const middleware = createBullBoardAuthMiddleware('admin', 'secret');
    const next = jest.fn() as NextFunction;
    const res = mockRes();
    const token = Buffer.from('admin:wrong').toString('base64');

    middleware(
      { headers: { authorization: `Basic ${token}` } } as Request,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the decoded header has no separator', () => {
    const middleware = createBullBoardAuthMiddleware('admin', 'secret');
    const next = jest.fn() as NextFunction;
    const res = mockRes();
    const token = Buffer.from('admin-without-separator').toString('base64');

    middleware(
      { headers: { authorization: `Basic ${token}` } } as Request,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('calls next when credentials match', () => {
    const middleware = createBullBoardAuthMiddleware('admin', 'secret');
    const next = jest.fn() as NextFunction;
    const res = mockRes();
    const token = Buffer.from('admin:secret').toString('base64');

    middleware(
      { headers: { authorization: `Basic ${token}` } } as Request,
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
