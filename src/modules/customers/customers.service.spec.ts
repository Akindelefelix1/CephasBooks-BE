import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service.ts';
import { jest } from '@jest/globals';

describe('CustomersService tenant isolation', () => {
  it('scopes record lookup to the authenticated organization', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new CustomersService({ customer: { findFirst } } as never);
    await expect(service.get('org-a', 'customer-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'customer-id', organizationId: 'org-a' },
    });
  });

  it('loads purchase history within the authenticated organization', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'customer-id' });
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CustomersService({ customer: { findFirst }, invoice: { findMany } } as never);

    await expect(service.purchaseHistory('org-a', 'customer-id')).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', customerId: 'customer-id' },
      include: { customer: true, items: true },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  });
});
