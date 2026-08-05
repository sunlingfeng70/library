import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthPrincipal } from '../auth-principal';

interface RequestWithUser {
  user?: AuthPrincipal;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new Error('CurrentUser used without JwtAuthGuard');
    }
    return request.user;
  },
);