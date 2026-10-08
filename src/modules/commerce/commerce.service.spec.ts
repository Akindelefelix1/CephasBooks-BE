import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { CommerceService } from './commerce.service.ts';

describe('CommerceService', () => {
  it('creates a channel against active central inventory and an active branch', async () => {
    const create = jest.fn().mockImplementation((request: { data: unknown }) => request.data);
    const service = new CommerceService({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-a' }) },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          onboardingData: {
            admin: { branches: { items: [{ id: 'branch-a', status: 'Active' }] } },
          },
        }),
      },
      commerceChannel: { findFirst: jest.fn().mockResolvedValue(null), create },
    } as never);

    await service.createChannel('org-a', {
      name: ' Lagos Store ',
      type: 'POS',
      branchId: 'branch-a',
      warehouseId: 'warehouse-a',
      syncInventory: true,
      syncOrders: true,
      syncCustomers: true,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-a',
          name: 'Lagos Store',
          warehouseId: 'warehouse-a',
        }) as unknown,
      }),
    );
  });

  it('publishes central stock only to active inventory-synced channels', async () => {
    const service = new CommerceService({
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'product-a',
            sku: 'SKU-1',
            name: 'Product A',
            category: 'Food',
            unit: 'piece',
            salePrice: new Prisma.Decimal(500),
          },
        ]),
      },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          { productId: 'product-a', type: 'RECEIPT', quantity: new Prisma.Decimal(12) },
          { productId: 'product-a', type: 'ISSUE', quantity: new Prisma.Decimal(2) },
        ]),
      },
      commerceChannel: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'channel-a', name: 'Store' },
          { id: 'channel-b', name: 'B2B' },
        ]),
      },
    } as never);

    const catalog = await service.catalog('org-a');

    expect(catalog).toEqual([
      expect.objectContaining({
        id: 'product-a',
        stockQuantity: new Prisma.Decimal(10),
        channelCount: 2,
      }),
    ]);
  });
});
