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
  AiQueryDto,
  ReportStatusDto,
  RunSyncDto,
  SavedReportDto,
  WorkbookDto,
  WorkbookStatusDto,
} from './dto/insights.dto.ts';
import { InsightsService } from './insights.service.ts';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}
  @Get('reports') reports(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.insights.reports(u.organizationId, q);
  }
  @Get('analytics') analytics(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.insights.analytics(u.organizationId, q);
  }
  @Get('saved-reports') savedReports(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string>,
  ) {
    return this.insights.savedReports(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('saved-reports') createReport(
    @CurrentUser() u: AuthUser,
    @Body() d: SavedReportDto,
  ) {
    return this.insights.createReport(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('saved-reports/:id') reportStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ReportStatusDto,
  ) {
    return this.insights.reportStatus(u.organizationId, id, d.isArchived);
  }
  @Roles(Role.OWNER, Role.ADMIN) @Delete('saved-reports/:id') deleteReport(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.insights.deleteReport(u.organizationId, id);
  }
  @Get('ai/history') aiHistory(@CurrentUser() u: AuthUser) {
    return this.insights.aiHistory(u.organizationId);
  }
  @Post('ai/query') queryAi(@CurrentUser() u: AuthUser, @Body() d: AiQueryDto) {
    return this.insights.queryAi(u.organizationId, d.question);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Delete('ai/history') clearAi(
    @CurrentUser() u: AuthUser,
  ) {
    return this.insights.clearAi(u.organizationId);
  }
  @Get('workbooks') workbooks(@CurrentUser() u: AuthUser) {
    return this.insights.workbooks(u.organizationId);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('workbooks') createWorkbook(
    @CurrentUser() u: AuthUser,
    @Body() d: WorkbookDto,
  ) {
    return this.insights.createWorkbook(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('workbooks/:id/status') workbookStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: WorkbookStatusDto,
  ) {
    return this.insights.workbookStatus(u.organizationId, id, d.status);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('workbooks/:id/run') runSync(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: RunSyncDto,
  ) {
    return this.insights.runSync(u.organizationId, id, d);
  }
  @Roles(Role.OWNER, Role.ADMIN) @Delete('workbooks/:id') deleteWorkbook(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.insights.deleteWorkbook(u.organizationId, id);
  }
}
