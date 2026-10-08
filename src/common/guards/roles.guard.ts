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
    if (!user.customRoleId)
      return !roles?.length || roles.includes(user.role as Role);
    // An endpoint explicitly reserved to the owner can never be delegated by a
    // custom access level (for example organisation deletion).
    if (roles?.length === 1 && roles[0] === Role.OWNER) return false;
    // POS sales need a read-only catalogue and warehouse list to select stock.
    // This does not grant access to inventory mutations or expose inventory UI.
    if (
      request.method === 'GET' &&
      /\/operations\/(products|warehouses)(?:\/|\?|$)/.test(request.url) &&
      user.permissions?.includes('sales.view')
    )
      return true;
    // Purchase entry needs the account selector, but not transaction or balance
    // management. Keep this dependency read-only and limited to account lists.
    if (
      request.method === 'GET' &&
      /\/banking\/accounts(?:\/|\?|$)/.test(request.url) &&
      user.permissions?.includes('purchases.manage')
    )
      return true;
    // Branch configuration uses members and roles for manager assignment.
    if (
      request.method === 'GET' &&
      /\/organizations\/current\/(users|roles)(?:\/|\?|$)/.test(request.url) &&
      user.permissions?.includes('settings.manage')
    )
      return true;
    const required = this.permissionFor(request.method, request.url);
    if (required) return Boolean(user.permissions?.includes(required));
    return !roles?.length || roles.includes(user.role as Role);
  }

  private permissionFor(method: string, url: string): string | null {
    const action = method === 'GET' ? 'view' : 'manage';
    if (/\/banking(?:\/|\?|$)/.test(url)) return `banking.${action}`;
    if (/\/(sales|invoices|customers|pos)(?:\/|\?|$)/.test(url)) return `sales.${action}`;
    if (/\/purchases(?:\/|\?|$)/.test(url)) return `purchases.${action}`;
    if (/\/accounting(?:\/|\?|$)/.test(url)) return `accounting.${action}`;
    if (/\/operations(?:\/|\?|$)/.test(url)) return `inventory.${action}`;
    if (/\/commerce\/orders(?:\/|\?|$)/.test(url)) return `sales.${action}`;
    if (/\/commerce(?:\/|\?|$)/.test(url)) return `inventory.${action}`;
    if (/\/insights(?:\/|\?|$)/.test(url))
      return method === 'GET' ? 'reports.view' : 'reports.export';
    if (/\/workflow\/approvals(?:\/|\?|$)/.test(url)) return 'approvals.review';
    if (/\/organizations\/current\/(users|roles)(?:\/|\?|$)/.test(url)) return `users.${action}`;
    if (/\/organizations\/current\/audit-logs(?:\/|\?|$)/.test(url)) return 'users.view';
    // Every authenticated member needs the completed/onboarding state after
    // login. Mutating onboarding routes remain protected by their @Roles
    // decorators and the settings permission below.
    if (method === 'GET' && /\/organizations\/current\/onboarding(?:\/|\?|$)/.test(url))
      return null;
    if (/\/organizations\/current(?:\/|\?|$)/.test(url)) return 'settings.manage';
    return null;
  }
}
