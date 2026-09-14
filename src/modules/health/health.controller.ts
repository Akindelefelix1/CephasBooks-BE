import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService, private readonly database: PrismaHealthIndicator, private readonly prisma: PrismaService) {}
  @Get('live') live() { return { status: 'ok', timestamp: new Date().toISOString() }; }
  @Get('ready') @HealthCheck() ready() { return this.health.check([() => this.database.pingCheck('database', this.prisma)]); }
}
