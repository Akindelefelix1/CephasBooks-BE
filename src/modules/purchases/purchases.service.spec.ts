import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { PurchasesService } from './purchases.service.ts';

describe('PurchasesService', () => {
  it('calculates request totals on the server and submits for approval', async () => {
    const create = jest.fn().mockImplementation((request) => Promise.resolve(request));
    const service = new PurchasesService({ purchaseRequest: { create } } as never);
    await service.createRequest('org-a', {
      number: 'PR-1',
      requestedBy: 'Ada',
      requiredDate: '2026-09-20',
      items: [{ description: 'Paper', quantity: 2, unitPrice: 100, taxRate: 7.5 }],
    });
    const data = (create.mock.calls[0]?.[0] as { data: { total: Prisma.Decimal; status: string } })
      .data;
    expect(data.total.toString()).toBe('215');
    expect(data.status).toBe('PENDING');
  });

  it('rejects supplier payments above the outstanding bill balance', async () => {
    const tx = {
      bill: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'bill',
          total: new Prisma.Decimal(100),
          paidAmount: new Prisma.Decimal(40),
        }),
      },
    };
    const service = new PurchasesService({
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);
    await expect(
      service.createPayment('org-a', {
        billId: 'bill',
        reference: 'PAY-1',
        paymentDate: '2026-09-15',
        amount: 61,
        method: 'Cash',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
