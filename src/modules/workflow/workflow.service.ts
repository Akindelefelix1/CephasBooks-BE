import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, DocumentStatus, WorkflowStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import type {
  ApprovalDecisionDto,
  ApprovalDto,
  DocumentDto,
  NotificationDto,
  WorkflowDto,
} from './dto/workflow.dto.ts';

@Injectable()
export class WorkflowService {
  constructor(private readonly db: PrismaService) {}
  async summary(org: string) {
    const [documents, pendingApprovals, unreadNotifications, activeRules, runs, failures] =
      await Promise.all([
        this.db.documentRecord.count({ where: { organizationId: org, status: 'ACTIVE' } }),
        this.db.approvalRequest.count({ where: { organizationId: org, status: 'PENDING' } }),
        this.db.appNotification.count({ where: { organizationId: org, isRead: false } }),
        this.db.workflowRule.count({ where: { organizationId: org, status: 'ACTIVE' } }),
        this.db.workflowRule.aggregate({
          where: { organizationId: org },
          _sum: { runCount: true },
        }),
        this.db.workflowRule.aggregate({
          where: { organizationId: org },
          _sum: { failureCount: true },
        }),
      ]);
    return {
      documents,
      pendingApprovals,
      unreadNotifications,
      activeRules,
      runs: runs._sum.runCount ?? 0,
      failures: failures._sum.failureCount ?? 0,
    };
  }
  documents(org: string, q: Record<string, string>) {
    return this.db.documentRecord.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : { status: 'ACTIVE' }),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { category: { contains: q.search, mode: 'insensitive' } },
                { linkedReference: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        category: true,
        mimeType: true,
        size: true,
        linkedType: true,
        linkedReference: true,
        notes: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createDocument(org: string, d: DocumentDto) {
    if (Boolean(d.linkedType) !== Boolean(d.linkedReference))
      throw new BadRequestException('Choose a linked record type and enter its reference');
    if (d.linkedType && d.linkedReference)
      await this.validateEntity(org, d.linkedType, undefined, d.linkedReference);
    const content = Buffer.from(d.contentBase64, 'base64');
    if (!content.length) throw new BadRequestException('The selected document is empty');
    if (content.length > 5 * 1024 * 1024)
      throw new BadRequestException('Documents must be 5 MB or smaller');
    return this.db.documentRecord.create({
      data: {
        organizationId: org,
        name: d.name.trim(),
        category: d.category.trim(),
        mimeType: d.mimeType,
        size: content.length,
        content,
        linkedType: d.linkedType?.trim() || undefined,
        linkedReference: d.linkedReference?.trim() || undefined,
        notes: d.notes?.trim() || undefined,
      },
      select: {
        id: true,
        name: true,
        category: true,
        mimeType: true,
        size: true,
        linkedType: true,
        linkedReference: true,
        notes: true,
        status: true,
        createdAt: true,
      },
    });
  }
  async download(org: string, id: string) {
    const item = await this.db.documentRecord.findFirst({ where: { id, organizationId: org } });
    if (!item) throw new NotFoundException('Document not found');
    return {
      name: item.name,
      mimeType: item.mimeType,
      contentBase64: Buffer.from(item.content).toString('base64'),
    };
  }
  async documentStatus(org: string, id: string, status: DocumentStatus) {
    await this.document(org, id);
    return this.db.documentRecord.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
  }
  async deleteDocument(org: string, id: string) {
    await this.document(org, id);
    await this.db.documentRecord.delete({ where: { id } });
    return { deleted: true };
  }
  approvals(org: string, q: Record<string, string>) {
    return this.db.approvalRequest.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' } },
                { reference: { contains: q.search, mode: 'insensitive' } },
                { requestedBy: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createApproval(org: string, requestedBy: string, d: ApprovalDto) {
    await this.validateEntity(org, d.entityType, d.entityId, d.reference);
    const approval = await this.db.approvalRequest.create({
      data: {
        ...d,
        title: d.title.trim(),
        reference: d.reference.trim(),
        notes: d.notes?.trim() || undefined,
        requestedBy,
        organizationId: org,
      },
    });
    await this.db.appNotification.create({
      data: {
        organizationId: org,
        title: 'Approval requested',
        message: `${approval.reference} requires ${approval.assignedRole.toLowerCase()} review.`,
        category: 'APPROVALS',
        relatedType: 'APPROVAL',
        relatedId: approval.id,
      },
    });
    return approval;
  }
  async decide(org: string, id: string, d: ApprovalDecisionDto) {
    const approval = await this.approval(org, id);
    if (approval.status !== 'PENDING')
      throw new BadRequestException('Only pending requests can be decided');
    const updated = await this.db.approvalRequest.update({
      where: { id },
      data: {
        status: d.status,
        decisionNote: d.decisionNote?.trim() || undefined,
        decidedAt: new Date(),
      },
    });
    await this.db.appNotification.create({
      data: {
        organizationId: org,
        title: `Approval ${d.status.toLowerCase()}`,
        message: `${approval.reference} was ${d.status.toLowerCase()}.`,
        category: 'APPROVALS',
        relatedType: 'APPROVAL',
        relatedId: id,
      },
    });
    return updated;
  }
  notifications(org: string, q: Record<string, string>) {
    return this.db.appNotification.findMany({
      where: {
        organizationId: org,
        ...(q.category ? { category: q.category as never } : {}),
        ...(q.unread === 'true' ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  createNotification(org: string, d: NotificationDto) {
    return this.db.appNotification.create({
      data: { ...d, title: d.title.trim(), message: d.message.trim(), organizationId: org },
    });
  }
  async read(org: string, id: string, isRead: boolean) {
    const item = await this.db.appNotification.findFirst({ where: { id, organizationId: org } });
    if (!item) throw new NotFoundException('Notification not found');
    return this.db.appNotification.update({ where: { id }, data: { isRead } });
  }
  async readAll(org: string) {
    const result = await this.db.appNotification.updateMany({
      where: { organizationId: org, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }
  rules(org: string, q: Record<string, string>) {
    return this.db.workflowRule.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
  createRule(org: string, d: WorkflowDto) {
    return this.db.workflowRule.create({
      data: { ...d, name: d.name.trim(), condition: d.condition.trim(), organizationId: org },
    });
  }
  async ruleStatus(org: string, id: string, status: WorkflowStatus) {
    await this.rule(org, id);
    return this.db.workflowRule.update({ where: { id }, data: { status } });
  }
  async runRule(org: string, id: string) {
    const rule = await this.rule(org, id);
    if (rule.status === 'PAUSED')
      throw new BadRequestException('Resume this workflow before running it');
    const result = await this.db.workflowRule.update({
      where: { id },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });
    await this.db.appNotification.create({
      data: {
        organizationId: org,
        title: 'Workflow completed',
        message: `${rule.name} ran successfully: ${rule.action.replaceAll('_', ' ').toLowerCase()}.`,
        category: 'SYSTEM',
        relatedType: 'WORKFLOW',
        relatedId: id,
      },
    });
    return result;
  }
  async deleteRule(org: string, id: string) {
    await this.rule(org, id);
    await this.db.workflowRule.delete({ where: { id } });
    return { deleted: true };
  }
  async executeEvent(
    org: string,
    event: string,
    record: {
      entityType: string;
      entityId: string;
      reference: string;
      title: string;
      amount?: number;
    },
  ) {
    const rules = await this.db.workflowRule.findMany({
      where: { organizationId: org, event, status: 'ACTIVE' },
    });
    for (const rule of rules) {
      if (!this.matches(rule.condition, record.amount)) continue;
      try {
        if (rule.action === 'CREATE_APPROVAL')
          await this.createApproval(org, 'Workflow automation', {
            title: record.title,
            entityType: record.entityType,
            entityId: record.entityId,
            reference: record.reference,
            amount: record.amount,
            assignedRole: 'APPROVER',
            notes: `Created by ${rule.name}`,
          });
        else
          await this.db.appNotification.create({
            data: {
              organizationId: org,
              title:
                rule.action === 'FLAG_FOR_REVIEW' ? 'Record needs review' : 'Workflow notification',
              message: `${record.reference}: ${rule.name}`,
              category: rule.action === 'FLAG_FOR_REVIEW' ? 'APPROVALS' : 'SYSTEM',
              relatedType: record.entityType,
              relatedId: record.entityId,
            },
          });
        await this.db.workflowRule.update({
          where: { id: rule.id },
          data: { runCount: { increment: 1 }, lastRunAt: new Date() },
        });
      } catch {
        await this.db.workflowRule.update({
          where: { id: rule.id },
          data: { failureCount: { increment: 1 }, lastRunAt: new Date() },
        });
      }
    }
  }
  private async document(org: string, id: string) {
    const item = await this.db.documentRecord.findFirst({ where: { id, organizationId: org } });
    if (!item) throw new NotFoundException('Document not found');
    return item;
  }
  private async approval(org: string, id: string) {
    const item = await this.db.approvalRequest.findFirst({ where: { id, organizationId: org } });
    if (!item) throw new NotFoundException('Approval request not found');
    return item;
  }
  private async rule(org: string, id: string) {
    const item = await this.db.workflowRule.findFirst({ where: { id, organizationId: org } });
    if (!item) throw new NotFoundException('Workflow not found');
    return item;
  }
  private async validateEntity(org: string, type: string, id?: string, reference?: string) {
    if (type === 'MANUAL') return;
    const lookups: Record<string, () => Promise<unknown>> = {
      INVOICE: () =>
        this.db.invoice.findFirst({
          where: { organizationId: org, ...(id ? { id } : { number: reference }) },
          select: { id: true },
        }),
      BILL: () =>
        this.db.bill.findFirst({
          where: { organizationId: org, ...(id ? { id } : { number: reference }) },
          select: { id: true },
        }),
      EXPENSE: () =>
        this.db.expense.findFirst({
          where: { organizationId: org, ...(id ? { id } : { reference }) },
          select: { id: true },
        }),
      PURCHASE_ORDER: () =>
        this.db.purchaseOrder.findFirst({
          where: { organizationId: org, ...(id ? { id } : { number: reference }) },
          select: { id: true },
        }),
      PROJECT: () =>
        this.db.project.findFirst({
          where: { organizationId: org, ...(id ? { id } : { code: reference }) },
          select: { id: true },
        }),
    };
    if (!(await lookups[type]?.()))
      throw new BadRequestException(
        `The linked ${type.toLowerCase().replace('_', ' ')} record was not found`,
      );
  }
  private matches(condition: string, amount?: number) {
    const match = condition.match(/amount\s*(?:exceeds|>|above)\s*([\d,.]+)/i);
    return !match || (amount ?? 0) > Number(match[1]!.replaceAll(',', ''));
  }
}
