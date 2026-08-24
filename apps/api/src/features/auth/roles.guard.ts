import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest, AuthRole } from './auth.contracts';
import { AUTH_ROLES_METADATA } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<readonly AuthRole[] | undefined>(
      AUTH_ROLES_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (roles === undefined || roles.length === 0) return true;

    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().user;

    if (!roles.includes(principal.role)) {
      throw new ForbiddenException();
    }

    return true;
  }
}
