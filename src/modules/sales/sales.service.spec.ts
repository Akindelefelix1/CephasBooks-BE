import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { SalesService } from './sales.service.ts';

describe('SalesService', () => {
  it('requires quotation customers to belong to the organization', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new SalesService({ customer: { findFirst } } as never);
    await expect(
      service.createQuotation('org-a', {
        customerId: 'customer',
        currency: 'NGN',
        issueDate: '2026-09-15',
        expiryDate: '2026-09-30',
        items: [
          { name: 'Consulting', description: 'Work', quantity: 1, unitPrice: 100, taxRate: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'customer', organizationId: 'org-a', isActive: true },
    });
  });

  it('calculates quotation subtotal, tax, and total on the server', async () => {
    const create = jest.fn().mockImplementation((request) => Promise.resolve(request));
    const service = new SalesService({
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer' }) },
      quotation: { create, findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    await service.createQuotation('org-a', {
      customerId: 'customer',
      currency: 'NGN',
      issueDate: '2026-09-15',
      expiryDate: '2026-09-30',
      items: [
        { name: 'Consulting', description: 'Work', quantity: 2, unitPrice: 100, taxRate: 7.5 },
      ],
    });
    const data = (
      create.mock.calls[0]?.[0] as {
        data: { subtotal: Prisma.Decimal; taxTotal: Prisma.Decimal; total: Prisma.Decimal };
      }
    ).data;
    expect(data.subtotal.toString()).toBe('200');
    expect(data.taxTotal.toString()).toBe('15');
    expect(data.total.toString()).toBe('215');
    expect((data as unknown as { number: string }).number).toBe('QUO-00001');
  });

  it('increments quotation numbers while ignoring unrelated formats', async () => {
    const service = new SalesService({
      quotation: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { number: 'QUO-00003' },
            { number: 'quote-old' },
            { number: 'QUO-00011' },
          ]),
      },
    } as never);
    await expect(service.nextQuotationNumber('org-a')).resolves.toEqual({ number: 'QUO-00012' });
  });

  it('uses the standard invoice sequence when converting a quotation', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'invoice', number: 'INV-00008' });
    const update = jest.fn().mockResolvedValue({});
    const tx = { invoice: { create }, quotation: { update } };
    const service = new SalesService({
      quotation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'quote',
          organizationId: 'org-a',
          branchId: null,
          customerId: 'customer',
          status: 'ACCEPTED',
          currency: 'NGN',
          subtotal: new Prisma.Decimal(100),
          taxTotal: new Prisma.Decimal(0),
          total: new Prisma.Decimal(100),
          notes: null,
          items: [{ name: 'Item', description: 'Item', quantity: 1, unitPrice: 100, taxRate: 0 }],
        }),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([{ number: 'INV-00007' }, { number: 'legacy' }]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);

    await service.convertQuotation('org-a', 'quote');
    expect((create.mock.calls[0]?.[0] as { data: { number: string } }).data.number).toBe(
      'INV-00008',
    );
  });

  it('rejects payments greater than the outstanding invoice balance', async () => {
    const tx = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invoice',
          total: new Prisma.Decimal(100),
          paidAmount: new Prisma.Decimal(25),
          creditedAmount: new Prisma.Decimal(0),
        }),
      },
    };
    const service = new SalesService({
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);
    await expect(
      service.recordPayment('org-a', {
        invoiceId: 'invoice',
        reference: 'PAY-1',
        amount: 80,
        paymentDate: '2026-09-15',
        method: 'Bank transfer',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
