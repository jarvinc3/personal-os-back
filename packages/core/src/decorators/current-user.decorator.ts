import { createParamDecorator, ExecutionContext } from '@nestjs/common';

type AuthenticatedUser = Record<string, unknown> | undefined;

export const CurrentUser = createParamDecorator(
  (property: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!property || !user) {
      return user;
    }

    return user[property];
  },
);
