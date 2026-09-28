import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { InvoicesService } from './invoices.service.ts';

describe('InvoicesService', () => {
  it('persists shipping details and includes shipping in the invoice total', async () => {
    const create = jest.fn().mockImplementation((request) => Promise.resolve(request.data));
    const transaction = jest.fn().mockImplementation((operation) =>
      operation({ invoice: { create } }),
    );
    const service = new InvoicesService({
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'customer', branchId: null }),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
        create,
      },
      $transaction: transaction,
    } as never);

    await service.create('org-a', {
      customerId: 'customer',
      status: 'DRAFT',
      currency: 'NGN',
      issueDate: '2026-09-28',
      dueDate: '2026-10-28',
      shippingAddress: '12 Example Street, Lagos',
      shippingAmount: 2500,
      notes: 'Thank you for your order.',
      items: [
        {
          name: 'Books',
          description: 'Printed books',
          quantity: 2,
          unitPrice: 10000,
          taxRate: 7.5,
        },
      ],
    });

    const data = (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.shippingAddress).toBe('12 Example Street, Lagos');
    expect((data.shippingAmount as Prisma.Decimal).toString()).toBe('2500');
    expect((data.subtotal as Prisma.Decimal).toString()).toBe('20000');
    expect((data.taxTotal as Prisma.Decimal).toString()).toBe('1500');
    expect((data.total as Prisma.Decimal).toString()).toBe('24000');
  });
});
