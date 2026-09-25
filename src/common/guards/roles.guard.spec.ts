import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { jest } from '@jest/globals';
import { RolesGuard } from './roles.guard.ts';

describe('RolesGuard custom permissions', () => {
  const context = (permissions: string[], method = 'POST', url = '/api/v1/sales/quotations') =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url,
          user: { role: Role.ACCOUNTANT, customRoleId: 'role-a', permissions },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('allows a custom role when its base role and granular permission both allow access', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ACCOUNTANT]) };
    expect(
      new RolesGuard(reflector as unknown as Reflector).canActivate(context(['sales.manage'])),
    ).toBe(true);
  });

  it('denies a custom role when the granular permission is missing', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ACCOUNTANT]) };
    expect(
      new RolesGuard(reflector as unknown as Reflector).canActivate(context(['sales.view'])),
    ).toBe(false);
  });

  it('enforces custom permissions without a system-role decorator', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new RolesGuard(reflector as unknown as Reflector);
    expect(guard.canActivate(context(['sales.view'], 'GET'))).toBe(true);
    expect(guard.canActivate(context([], 'GET'))).toBe(false);
  });
});
