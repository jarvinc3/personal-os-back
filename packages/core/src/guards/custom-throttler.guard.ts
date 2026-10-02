import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { sub?: string } | undefined;
    const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(user?.sub ?? ip);
  }

  protected getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    const http = context.switchToHttp();
    return {
      req: http.getRequest<Record<string, unknown>>(),
      res: http.getResponse<Record<string, unknown>>(),
    };
  }
}
