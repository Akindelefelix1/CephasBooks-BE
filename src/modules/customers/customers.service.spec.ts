import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService tenant isolation', () => {
  it('scopes record lookup to the authenticated organization', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new CustomersService({ customer: { findFirst } } as never);
    await expect(service.get('org-a', 'customer-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'customer-id', organizationId: 'org-a' } });
  });
});
