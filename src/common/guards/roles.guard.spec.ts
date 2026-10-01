import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { jest } from '@jest/globals';
import { RolesGuard } from './roles.guard.ts';

describe('RolesGuard custom permissions', () => {
  const context = (
    permissions: string[],
    method = 'POST',
    url = '/api/v1/sales/quotations',
    role = Role.ACCOUNTANT,
  ) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url,
          user: { role, customRoleId: 'role-a', permissions },
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

  it('allows staff to read onboarding completion state after login', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context([], 'GET', '/api/v1/organizations/current/onboarding'),
      ),
    ).toBe(true);
  });

  it('allows sales staff to read the product catalogue required by POS', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(['sales.view'], 'GET', '/api/v1/operations/products?status=active'),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        context(['sales.view'], 'GET', '/api/v1/operations/warehouses?status=active'),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(context(['sales.view'], 'POST', '/api/v1/operations/products')),
    ).toBe(false);
  });

  it('lets a custom manage permission override its base role on mapped modules', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([Role.OWNER, Role.ADMIN, Role.ACCOUNTANT]),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(['sales.manage'], 'POST', '/api/v1/sales/quotations', Role.MEMBER),
      ),
    ).toBe(true);
  });

  it('allows inventory managers to create categories and products', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([Role.OWNER, Role.ADMIN, Role.ACCOUNTANT]),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(
          ['inventory.view', 'inventory.manage'],
          'POST',
          '/api/v1/operations/product-categories',
          Role.MEMBER,
        ),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        context(
          ['inventory.view', 'inventory.manage'],
          'POST',
          '/api/v1/operations/products',
          Role.MEMBER,
        ),
      ),
    ).toBe(true);
  });

  it('keeps inventory view-only access read-only', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([Role.OWNER, Role.ADMIN, Role.ACCOUNTANT]),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(['inventory.view'], 'POST', '/api/v1/operations/products', Role.MEMBER),
      ),
    ).toBe(false);
  });

  it('never delegates an owner-only endpoint through a custom permission', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER]) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(['settings.manage'], 'DELETE', '/api/v1/organizations/current', Role.ADMIN),
      ),
    ).toBe(false);
  });

  it('allows purchase managers to read bank accounts needed for payment entry', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(['purchases.manage'], 'GET', '/api/v1/banking/accounts', Role.MEMBER),
      ),
    ).toBe(true);
  });

  it('maps audit logs to user-view access instead of settings management', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER, Role.ADMIN, Role.AUDITOR]),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(['users.view'], 'GET', '/api/v1/organizations/current/audit-logs', Role.MEMBER),
      ),
    ).toBe(true);
  });

  it('allows settings managers to read members needed for branch assignment', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER, Role.ADMIN, Role.AUDITOR]),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(
      guard.canActivate(
        context(['settings.manage'], 'GET', '/api/v1/organizations/current/users', Role.MEMBER),
      ),
    ).toBe(true);
  });
});
