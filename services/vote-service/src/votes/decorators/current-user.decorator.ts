import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../entities/auth-user.entity';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
