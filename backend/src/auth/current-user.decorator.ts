// Param decorator that injects the authenticated user into a handler,
// e.g. `me(@CurrentUser() user: AuthUser)` — sugar over reading request.user.
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
}

// Pulls the user that JwtStrategy.validate() attached to the request.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
