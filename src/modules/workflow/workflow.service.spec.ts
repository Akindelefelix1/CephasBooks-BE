import { BadRequestException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { WorkflowService } from './workflow.service.ts';

describe('WorkflowService', () => {
  it('rejects documents larger than five megabytes', async () => {
    const create = jest.fn();
    const service = new WorkflowService({ documentRecord: { create } } as never);
    await expect(
      service.createDocument('org-a', {
        name: 'large.pdf',
        category: 'Other',
        mimeType: 'application/pdf',
        contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not expose a document from another organisation', async () => {
    const service = new WorkflowService({
      documentRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never);
    await expect(service.download('org-a', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only decides pending approvals', async () => {
    const update = jest.fn();
    const service = new WorkflowService({
      approvalRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: 'approval', status: 'APPROVED' }),
        update,
      },
    } as never);
    await expect(
      service.decide('org-a', 'approval', 'APPROVER', { status: 'REJECTED' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('enforces the assigned approval role', async () => {
    const update = jest.fn();
    const service = new WorkflowService({
      approvalRequest: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'approval', status: 'PENDING', assignedRole: 'OWNER' }),
        update,
      },
    } as never);
    await expect(
      service.decide('org-a', 'approval', 'APPROVER', { status: 'APPROVED' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('stores notification read state for the current user only', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const service = new WorkflowService({
      appNotification: {
        findFirst: jest.fn().mockResolvedValue({ id: 'notice', organizationId: 'org-a' }),
      },
      notificationReceipt: { upsert },
    } as never);
    await service.read('org-a', 'user-a', 'notice', true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { notificationId_userId: { notificationId: 'notice', userId: 'user-a' } },
      }),
    );
  });

  it('runs amount workflows only when their threshold matches', async () => {
    const create = jest.fn();
    const update = jest.fn();
    const service = new WorkflowService({
      workflowRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule',
            name: 'Large invoice',
            condition: 'amount exceeds 500000',
            action: 'SEND_NOTIFICATION',
          },
        ]),
        update,
      },
      appNotification: { create },
    } as never);
    await service.executeEvent('org-a', 'INVOICE_CREATED', {
      entityType: 'INVOICE',
      entityId: 'invoice',
      reference: 'INV-1',
      title: 'Invoice',
      amount: 200000,
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    await service.executeEvent('org-a', 'INVOICE_CREATED', {
      entityType: 'INVOICE',
      entityId: 'invoice',
      reference: 'INV-1',
      title: 'Invoice',
      amount: 600000,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
