import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator.ts';
import type { AuthUser } from '../decorators/current-user.decorator.ts';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context
      .switchToHttp()
      .getRequest<{ user: AuthUser; method: string; url: string }>();
    const user = request.user;
    if (roles?.length && !roles.includes(user.role as Role)) return false;
    if (!user.customRoleId) return true;
    const required = this.permissionFor(request.method, request.url);
    return required ? Boolean(user.permissions?.includes(required)) : true;
  }

  private permissionFor(method: string, url: string): string | null {
    const action = method === 'GET' ? 'view' : 'manage';
    if (/\/banking(?:\/|\?|$)/.test(url)) return `banking.${action}`;
    if (/\/(sales|invoices|customers|pos)(?:\/|\?|$)/.test(url)) return `sales.${action}`;
    if (/\/purchases(?:\/|\?|$)/.test(url)) return `purchases.${action}`;
    if (/\/accounting(?:\/|\?|$)/.test(url)) return `accounting.${action}`;
    if (/\/operations(?:\/|\?|$)/.test(url)) return `inventory.${action}`;
    if (/\/insights(?:\/|\?|$)/.test(url))
      return method === 'GET' ? 'reports.view' : 'reports.export';
    if (/\/workflow\/approvals(?:\/|\?|$)/.test(url)) return 'approvals.review';
    if (/\/organizations\/current\/(users|roles)(?:\/|\?|$)/.test(url)) return `users.${action}`;
    if (/\/organizations\/current(?:\/|\?|$)/.test(url)) return 'settings.manage';
    return null;
  }
}
