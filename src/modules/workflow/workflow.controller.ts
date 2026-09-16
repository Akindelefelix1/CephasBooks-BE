import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import {
  ApprovalDecisionDto,
  ApprovalDto,
  DocumentDto,
  DocumentStatusDto,
  NotificationDto,
  ReadDto,
  WorkflowDto,
  WorkflowStatusDto,
} from './dto/workflow.dto.ts';
import { WorkflowService } from './workflow.service.ts';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}
  @Get('summary') summary(@CurrentUser() u: AuthUser) {
    return this.service.summary(u.organizationId, u.sub);
  }
  @Get('documents') documents(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.service.documents(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.MEMBER) @Post('documents') createDocument(
    @CurrentUser() u: AuthUser,
    @Body() d: DocumentDto,
  ) {
    return this.service.createDocument(u.organizationId, d);
  }
  @Get('documents/:id/download') download(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.download(u.organizationId, id);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('documents/:id/status') documentStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: DocumentStatusDto,
  ) {
    return this.service.documentStatus(u.organizationId, id, d.status);
  }
  @Roles(Role.OWNER, Role.ADMIN) @Delete('documents/:id') deleteDocument(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteDocument(u.organizationId, id);
  }
  @Get('approvals') approvals(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.service.approvals(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.MEMBER) @Post('approvals') createApproval(
    @CurrentUser() u: AuthUser,
    @Body() d: ApprovalDto,
  ) {
    return this.service.createApproval(u.organizationId, u.email, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Patch('approvals/:id/decision')
  decide(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ApprovalDecisionDto,
  ) {
    return this.service.decide(u.organizationId, id, u.role, d);
  }
  @Get('notifications') notifications(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return this.service.notifications(u.organizationId, u.sub, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('notifications') createNotification(
    @CurrentUser() u: AuthUser,
    @Body() d: NotificationDto,
  ) {
    return this.service.createNotification(u.organizationId, d);
  }
  @Patch('notifications/read-all') readAll(@CurrentUser() u: AuthUser) {
    return this.service.readAll(u.organizationId, u.sub);
  }
  @Patch('notifications/:id/read') read(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ReadDto,
  ) {
    return this.service.read(u.organizationId, u.sub, id, d.isRead ?? true);
  }
  @Get('rules') rules(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.service.rules(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('rules') createRule(
    @CurrentUser() u: AuthUser,
    @Body() d: WorkflowDto,
  ) {
    return this.service.createRule(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('rules/:id/status') ruleStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: WorkflowStatusDto,
  ) {
    return this.service.ruleStatus(u.organizationId, id, d.status);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('rules/:id/run') runRule(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.runRule(u.organizationId, id);
  }
  @Roles(Role.OWNER, Role.ADMIN) @Delete('rules/:id') deleteRule(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteRule(u.organizationId, id);
  }
}
