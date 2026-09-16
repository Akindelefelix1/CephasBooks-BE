import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { InsightsService } from './insights.service.ts';

const decimal = (value: number) => new Prisma.Decimal(value);

describe('InsightsService', () => {
  it('calculates reports only from posted business records', async () => {
    const db = {
      organization: { findUniqueOrThrow: jest.fn().mockResolvedValue({ baseCurrency: 'NGN' }) },
      invoice: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              total: decimal(100),
              paidAmount: decimal(40),
              creditedAmount: decimal(10),
              status: 'SENT',
              issueDate: new Date('2026-09-01'),
            },
          ]),
      },
      expense: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { amount: decimal(20), category: 'Travel', expenseDate: new Date('2026-09-02') },
          ]),
      },
      bill: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { total: decimal(30), paidAmount: decimal(5), issueDate: new Date('2026-09-03') },
          ]),
      },
      paymentReceived: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ amount: decimal(40), paymentDate: new Date('2026-09-04') }]),
      },
      supplierPayment: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ amount: decimal(5), paymentDate: new Date('2026-09-05') }]),
      },
      bankAccount: { findMany: jest.fn().mockResolvedValue([{ currentBalance: decimal(200) }]) },
      product: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'p1', name: 'Fabric', costPrice: decimal(4) }]),
      },
      stockMovement: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ productId: 'p1', quantity: decimal(3), type: 'RECEIPT' }]),
      },
      project: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              status: 'ACTIVE',
              budget: decimal(50),
              actualCost: decimal(20),
              revenue: decimal(10),
            },
          ]),
      },
    };
    const result = await new InsightsService(db as never).reports('org-a', {});
    expect(String(result.metrics.revenue)).toBe('90');
    expect(String(result.metrics.expenses)).toBe('50');
    expect(String(result.metrics.profit)).toBe('40');
    expect(String(result.metrics.receivables)).toBe('50');
    expect(String(result.metrics.inventoryValue)).toBe('12');
    expect(db.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          status: { in: ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] },
        }),
      }),
    );
  });

  it('rejects invalid and reversed saved-report date ranges', async () => {
    const service = new InsightsService({ savedReport: { create: jest.fn() } } as never);
    expect(() =>
      service.createReport('org-a', {
        name: 'Bad',
        type: 'EXECUTIVE',
        dateFrom: '2026-02-30',
      } as never),
    ).toThrow(BadRequestException);
    expect(() =>
      service.createReport('org-a', {
        name: 'Reverse',
        type: 'EXECUTIVE',
        dateFrom: '2026-09-20',
        dateTo: '2026-09-10',
      } as never),
    ).toThrow(BadRequestException);
  });

  it('does not allow an import sync without a selected file', async () => {
    const service = new InsightsService({
      workbookConnection: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'sync',
            organizationId: 'org-a',
            direction: 'IMPORT',
            status: 'ACTIVE',
          }),
      },
    } as never);
    await expect(service.runSync('org-a', 'sync', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not expose workbook connections belonging to another organisation', async () => {
    const update = jest.fn();
    const service = new InsightsService({
      workbookConnection: { findFirst: jest.fn().mockResolvedValue(null), update },
    } as never);
    await expect(service.workbookStatus('org-a', 'foreign', 'PAUSED')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
